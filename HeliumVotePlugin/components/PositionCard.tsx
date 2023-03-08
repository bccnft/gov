import React, { useCallback, useState, useEffect } from 'react'
import useRealm from '@hooks/useRealm'
import useVotePluginsClientStore from 'stores/useVotePluginsClientStore'
import useWalletStore from 'stores/useWalletStore'
import { fmtMintAmount } from '@tools/sdk/units'
import { PositionWithMeta, SubDaoWithMeta } from '../sdk/types'
import tokenPriceService from '@utils/services/tokenPrice'
import { abbreviateAddress } from '@utils/formatting'
import {
  daysToSecs,
  getMinDurationFmt,
  getTimeLeftFromNowFmt,
  secsToDays,
} from 'VoteStakeRegistry/tools/dateTools'
import { useUnixNow } from '@hooks/useUnixNow'
import { BN, web3 } from '@project-serum/anchor'
import Button from '@components/Button'
import useHeliumVsrStore from 'HeliumVotePlugin/hooks/useHeliumVsrStore'
import {
  LockTokensModal,
  LockTokensModalFormValues,
} from 'HeliumVotePlugin/components/LockTokensModal'
import { TransferTokensModal } from './TransferTokensModal'
import { calcLockupMultiplier } from 'HeliumVotePlugin/utils/calcLockupMultiplier'
import { useUnlockPosition } from 'HeliumVotePlugin/hooks/useUnlockPosition'
import { useExtendPosition } from 'HeliumVotePlugin/hooks/useExtendPosition'
import { useTransferPosition } from 'HeliumVotePlugin/hooks/useTransferPosition'
import { notify } from '@utils/notifications'
import { useClosePosition } from 'HeliumVotePlugin/hooks/useClosePosition'
import { HNT_MINT } from '@helium/spl-utils'
import { DelegateTokensModal } from './DelegateTokensModal'
import { useDelegatePosition } from 'HeliumVotePlugin/hooks/useDelegatePosition'
import { useUndelegatePosition } from 'HeliumVotePlugin/hooks/useUndelegatePosition'

export interface PositionCardProps {
  position: PositionWithMeta
}

export const PositionCard: React.FC<PositionCardProps> = ({ position }) => {
  const { unixNow = 0 } = useUnixNow()
  const [isTransferModalOpen, setIsTransferModalOpen] = useState(false)
  const [isExtendModalOpen, setIsExtendModalOpen] = useState(false)
  const [isDelegateModalOpen, setIsDelegateModalOpen] = useState(false)
  const [transferablePositions, setTransferablePositions] = useState<
    PositionWithMeta[]
  >([])
  const { realm, realmInfo } = useRealm()
  const [isLoading, positions, getPositions] = useHeliumVsrStore((s) => [
    s.state.isLoading,
    s.state.positions,
    s.getPositions,
  ])
  const [
    currentClient,
    vsrClient,
    vsrRegistrar,
  ] = useVotePluginsClientStore((s) => [
    s.state.currentRealmVotingClient,
    s.state.heliumVsrClient,
    s.state.heliumVsrRegistrar,
  ])

  const {
    loading: isExtending,
    error: extendingError,
    extendPosition,
  } = useExtendPosition()

  const {
    loading: isUnlocking,
    error: unlockingError,
    unlockPosition,
  } = useUnlockPosition()

  const {
    loading: isTransfering,
    error: transferingError,
    transferPosition,
  } = useTransferPosition()

  const {
    loading: isClosing,
    error: closingError,
    closePosition,
  } = useClosePosition()

  const {
    loading: isDelegating,
    error: delegationError,
    delegatePosition,
  } = useDelegatePosition()

  const {
    loading: isUndelegating,
    error: undelegationError,
    undelegatePosition,
  } = useUndelegatePosition()

  const [
    connection,
    wallet,
    { fetchRealm, fetchWalletTokenAccounts },
  ] = useWalletStore((s) => [s.connection.current, s.current, s.actions])

  useEffect(() => {
    if (position && unixNow && positions.length > 0) {
      const lockup = position.lockup
      const lockupKind = Object.keys(lockup.kind)[0]
      const positionLockupPeriodInDays = secsToDays(
        lockupKind === 'constant'
          ? lockup.endTs.sub(lockup.startTs).toNumber()
          : lockup.endTs.sub(new BN(unixNow || 0)).toNumber()
      )

      setTransferablePositions(
        positions.filter((pos) => {
          const lockup = pos.lockup
          const lockupKind = Object.keys(lockup.kind)[0]
          const lockupPeriodInDays = secsToDays(
            lockupKind === 'constant'
              ? lockup.endTs.sub(lockup.startTs).toNumber()
              : lockup.endTs.sub(new BN(unixNow)).toNumber()
          )

          return (
            !position.pubkey.equals(pos.pubkey) &&
            lockupPeriodInDays >= positionLockupPeriodInDays
          )
        })
      )
    }
  }, [position, unixNow, positions, setTransferablePositions])

  const lockup = position.lockup
  const lockupKind = Object.keys(lockup.kind)[0] as string
  const lockupExpired =
    lockupKind !== 'constant' && lockup.endTs.sub(new BN(unixNow)).lt(new BN(0))

  const lockedTokens = fmtMintAmount(
    position.votingMint.mint.account,
    position.amountDepositedNative
  )

  const isConstant = lockupKind === 'constant'
  const isRealmCommunityMint =
    realm?.account.communityMint &&
    realm.account.communityMint.equals(position.votingMint.mint.publicKey)

  const canDelegate =
    isRealmCommunityMint &&
    (realm.account.communityMint.equals(HNT_MINT) ||
      // TODO (Bry): Remove vv
      realm.account.communityMint.equals(
        new web3.PublicKey('D5Eb8q17xYsfGFNKxy3GCkSn9QpAmmLHX6wjceEmatTq')
      ))

  const tokenInfo = tokenPriceService.getTokenInfo(
    position.votingMint.mint.publicKey.toBase58()
  )

  const handleCalcLockupMultiplier = useCallback(
    (lockupPeriodInDays: number) =>
      calcLockupMultiplier({
        lockupSecs: daysToSecs(lockupPeriodInDays),
        registrar: vsrRegistrar,
        realm,
      }),
    [realm, vsrRegistrar]
  )

  const refetchState = async () => {
    fetchWalletTokenAccounts()
    fetchRealm(realmInfo!.programId, realmInfo!.realmId)
    await getPositions({
      votingClient: currentClient,
      realmPk: realm!.pubkey,
      communityMintPk: realm!.account.communityMint,
      walletPk: wallet!.publicKey!,
      client: vsrClient!,
      connection,
    })
  }

  const handleUnlock = async () => {
    try {
      await unlockPosition({ position })

      if (!unlockingError) {
        await refetchState()
      }
    } catch (e) {
      notify({
        type: 'error',
        message: e.message || 'Unable to unlock tokens',
      })
    }
  }

  const handleExtendTokens = async (values: LockTokensModalFormValues) => {
    await extendPosition({
      position,
      lockupPeriodsInDays: values.lockupPeriodInDays,
    })

    if (!extendingError) {
      await refetchState()
    }
  }

  const handleTransferTokens = async (targetPosition: PositionWithMeta) => {
    await transferPosition({
      sourcePosition: position,
      targetPosition,
    })

    if (!transferingError) {
      await refetchState()
    }
  }

  const handleDelegateTokens = async (subDao: SubDaoWithMeta) => {
    await delegatePosition({
      position,
      subDao,
    })

    if (!delegationError) {
      await refetchState()
    }
  }

  const handleUndelegateTokens = async () => {
    // TODO (bry)
    console.log('UnDelegate')
    // try {
    //   await undelegatePosition({ position })

    //   if (!undelegatingError) {
    //     await refetchState()
    //   }
    // } catch (e) {
    //   notify({
    //     type: 'error',
    //     message: e.message || 'Unable to undelegate tokens',
    //   })
    // }
  }

  const handleClose = async () => {
    try {
      await closePosition({
        position,
      })

      if (!closingError) {
        await refetchState()
      }
    } catch (e) {
      notify({
        type: 'error',
        message: e.message || 'Unable to close position',
      })
    }
  }

  const CardLabel = ({ label, value }) => {
    return (
      <div className="flex flex-col w-1/2 py-2">
        <p className="text-xs text-fgd-2">{label}</p>
        <p className="font-bold text-fgd-1">{value}</p>
      </div>
    )
  }

  const isSubmitting =
    isExtending || isClosing || isTransfering || isUnlocking || isDelegating
  return (
    <div className="border border-fgd-4 rounded-lg flex flex-col">
      {isLoading ? (
        <>
          <div className="animate-pulse bg-bkg-3 col-span-1 h-44 rounded-md" />
          <div className="animate-pulse bg-bkg-3 col-span-1 h-44 rounded-md" />
          <div className="animate-pulse bg-bkg-3 col-span-1 h-44 rounded-md" />
        </>
      ) : (
        <>
          <div className="bg-bkg-3 px-4 py-4 pr-16 rounded-md rounded-b-none flex items-center">
            {tokenInfo?.logoURI && (
              <img className="w-8 h-8 mr-2" src={tokenInfo?.logoURI}></img>
            )}
            <h3 className="hero-text mb-0">
              {lockedTokens}{' '}
              {!tokenInfo?.logoURI &&
                abbreviateAddress(position.votingMint.mint.publicKey)}
              <span className="font-normal text-xs text-fgd-3">
                {tokenInfo?.symbol}
              </span>
            </h3>
          </div>
          <div
            className="p-4 rounded-lg flex flex-col h-full"
            style={{ minHeight: '220px' }}
          >
            <div className="flex flex-row flex-wrap mb-4">
              <CardLabel
                label="Lockup Type"
                value={lockupKind.charAt(0).toUpperCase() + lockupKind.slice(1)}
              />
              {isRealmCommunityMint && (
                <CardLabel
                  label="Vote Multiplier"
                  value={(position.votingPower.isZero()
                    ? 0
                    : position.votingPower.toNumber() /
                      position.amountDepositedNative.toNumber()
                  ).toFixed(2)}
                />
              )}
              <CardLabel
                label={isConstant ? 'Min. Duration' : 'Time left'}
                value={
                  isConstant
                    ? getMinDurationFmt(position.lockup as any)
                    : getTimeLeftFromNowFmt(position.lockup as any)
                }
              />
            </div>
            <div style={{ marginTop: 'auto' }}>
              {position.isDelegated ? (
                <Button
                  className="w-full"
                  onClick={() => console.log('Undelegate')}
                  disabled={isSubmitting}
                  isLoading={isSubmitting}
                >
                  UnDelegate
                </Button>
              ) : (
                <>
                  {lockupExpired ? (
                    <Button
                      className="w-full"
                      isLoading={isSubmitting}
                      disabled={isClosing}
                      onClick={handleClose}
                    >
                      Close
                    </Button>
                  ) : (
                    <div className="flex flex-col gap-2">
                      <div className="flex flex-row gap-2 justify-center">
                        <Button
                          className="w-full"
                          onClick={() => setIsExtendModalOpen(true)}
                          disabled={isSubmitting}
                          isLoading={isExtending}
                        >
                          Extend
                        </Button>
                        <Button
                          className="w-full"
                          onClick={() => setIsTransferModalOpen(true)}
                          disabled={
                            transferablePositions.length == 0 || isSubmitting
                          }
                          isLoading={isTransfering}
                        >
                          Transfer
                        </Button>
                      </div>
                      {isConstant && (
                        <Button
                          onClick={handleUnlock}
                          disabled={isSubmitting}
                          isLoading={isUnlocking}
                        >
                          Unlock
                        </Button>
                      )}
                      {canDelegate && (
                        <Button
                          className="w-full"
                          onClick={() => setIsDelegateModalOpen(true)}
                          disabled={isSubmitting}
                          isLoading={isDelegating}
                        >
                          Delegate
                        </Button>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </>
      )}
      {isExtendModalOpen && (
        <LockTokensModal
          mode="extend"
          isOpen={isExtendModalOpen}
          minLockupTimeInDays={Math.ceil(
            secsToDays(position.lockup.endTs.sub(new BN(unixNow)).toNumber())
          )}
          maxLockupAmount={position.amountDepositedNative.toNumber()}
          calcMultiplierFn={handleCalcLockupMultiplier}
          onClose={() => setIsExtendModalOpen(false)}
          onSubmit={handleExtendTokens}
        />
      )}
      {isTransferModalOpen && (
        <TransferTokensModal
          isOpen={isTransferModalOpen}
          positions={transferablePositions}
          onClose={() => setIsTransferModalOpen(false)}
          onSubmit={handleTransferTokens}
        />
      )}
      {canDelegate && isDelegateModalOpen && (
        <DelegateTokensModal
          isOpen={isDelegateModalOpen}
          onClose={() => setIsDelegateModalOpen(false)}
          onSubmit={handleDelegateTokens}
        />
      )}
    </div>
  )
}
