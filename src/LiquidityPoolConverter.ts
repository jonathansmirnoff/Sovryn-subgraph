import {
  LiquidityAdded as LiquidityAddedEvent,
  LiquidityRemoved as LiquidityRemovedEvent,
  Activation as ActivationEvent,
  Conversion as ConversionEventV1,
  WithdrawFees as WithdrawFeesEvent,
} from '../generated/templates/LiquidityPoolV1Converter/LiquidityPoolV1Converter'
import {
  Conversion as ConversionEventV2,
  LiquidityPoolV2Converter as LiquidityPoolV2Contract,
} from '../generated/templates/LiquidityPoolV2Converter/LiquidityPoolV2Converter'
import { Conversion as ConversionEventV1WithProtocol } from '../generated/templates/LiquidityPoolV1ConverterProtocolFee/LiquidityPoolV1ConverterProtocolFee'
import { LiquidityPool, LiquidityPoolToken, Token, Transaction } from '../generated/schema'
import { ConversionEventForSwap, createAndReturnSwap, updatePricing } from './utils/Swap'
import { createAndReturnToken, decimalizeFromToken } from './utils/Token'
import { createAndReturnTransaction } from './utils/Transaction'
import { BigInt, dataSource, Address, BigDecimal, ethereum } from '@graphprotocol/graph-ts'
import { createAndReturnSmartToken } from './utils/SmartToken'
import { createAndReturnPoolToken } from './utils/PoolToken'
import { updateVolumes } from './utils/Volumes'
import { updateCandleSticks } from './utils/Candlesticks'
import { LiquidityHistoryType } from './utils/types'
import { decrementPoolBalance, incrementPoolBalance } from './utils/LiquidityPool'
import { updateLiquidityHistory } from './utils/UserLiquidityHistory'
import { decimal } from '@protofire/subgraph-toolkit'
import { incrementProtocolAmmTotals, incrementUserAmmTotals } from './utils/ProtocolStats'
import { createAndReturnConversion } from './utils/Conversion'

export class IConversionEvent {
  transaction!: Transaction
  logIndex!: BigInt
  liquidityPool!: LiquidityPool
  fromToken!: Token
  toToken!: Token
  fromAmount!: BigDecimal
  toAmount!: BigDecimal
  trader!: Address
  user!: Address
  conversionFee!: BigDecimal
  protocolFee!: BigDecimal
}

export function handleLiquidityAdded(event: LiquidityAddedEvent): void {
  createAndReturnTransaction(event)
  const liquidityPool = LiquidityPool.load(event.address.toHexString())
  const liquidityPoolToken = LiquidityPoolToken.load(event.address.toHexString() + event.params._reserveToken.toHexString())
  const token = Token.load(event.params._reserveToken.toHexString())

  if (liquidityPool != null && liquidityPoolToken != null && token != null) {
    updateLiquidityHistory({
      id: event.transaction.hash.toHex() + '-' + event.logIndex.toString(),
      user: event.transaction.from.toHexString(),
      type: LiquidityHistoryType.Added,
      provider: event.params._provider.toHexString(),
      reserveToken: event.params._reserveToken.toHexString(),
      amount: decimalizeFromToken(event.params._amount, token),
      newBalance: decimalizeFromToken(event.params._newBalance, token),
      newSupply: decimalizeFromToken(event.params._newSupply, token),
      transaction: event.transaction.hash.toHexString(),
      timestamp: event.block.timestamp,
      emittedBy: event.address.toHexString(),
      liquidityPool: liquidityPool,
      liquidityPoolToken: liquidityPoolToken,
      token: event.params._reserveToken,
    })
  }
}

export function handleLiquidityRemoved(event: LiquidityRemovedEvent): void {
  createAndReturnTransaction(event)
  const liquidityPool = LiquidityPool.load(event.address.toHexString())
  const liquidityPoolToken = LiquidityPoolToken.load(event.address.toHexString() + event.params._reserveToken.toHexString())
  const token = Token.load(event.params._reserveToken.toHexString())

  if (liquidityPool != null && liquidityPoolToken != null && token != null) {
    updateLiquidityHistory({
      id: event.transaction.hash.toHex() + '-' + event.logIndex.toString(),
      user: event.transaction.from.toHexString(),
      type: LiquidityHistoryType.Removed,
      provider: event.params._provider.toHexString(),
      reserveToken: event.params._reserveToken.toHexString(),
      amount: decimalizeFromToken(event.params._amount, token),
      newBalance: decimalizeFromToken(event.params._newBalance, token),
      newSupply: decimalizeFromToken(event.params._newSupply, token),
      transaction: event.transaction.hash.toHexString(),
      timestamp: event.block.timestamp,
      emittedBy: event.address.toHexString(),
      liquidityPool: liquidityPool,
      liquidityPoolToken: liquidityPoolToken,
      token: event.params._reserveToken,
    })
  }
}

/** This event is triggered when a pool is activated or deactivated
 * TODO: Dry up this code by creating a base ABI with only the methods shared by all liquidity pools
 */
export function handleActivation(event: ActivationEvent): void {
  createAndReturnTransaction(event)
  const liquidityPool = LiquidityPool.load(dataSource.address().toHex())
  const contract = LiquidityPoolV2Contract.bind(event.address)
  const reserveTokenCountResult = contract.try_reserveTokenCount()
  if (liquidityPool != null) {
    liquidityPool.activated = event.params._activated

    if (event.params._activated == true) {
      const smartToken = createAndReturnSmartToken(event.params._anchor)
      liquidityPool.smartToken = smartToken.smartToken.id
    }

    if (!reserveTokenCountResult.reverted) {
      for (let i = 0; i < reserveTokenCountResult.value; i++) {
        const reserveTokenResult = contract.try_reserveTokens(BigInt.fromI32(i))
        if (!reserveTokenResult.reverted) {
          createAndReturnToken(reserveTokenResult.value, event.address, event.params._anchor)
          if (event.params._type == 1) {
            createAndReturnPoolToken(event.params._anchor, event.address, reserveTokenResult.value)
          } else if (event.params._type == 2) {
            const poolTokenResult = contract.try_poolToken(reserveTokenResult.value)
            if (!poolTokenResult.reverted) {
              createAndReturnPoolToken(poolTokenResult.value, event.address, reserveTokenResult.value)
            }
          }
        }
        if (i == 0) {
          liquidityPool.token0 = reserveTokenResult.value.toHexString()
        } else if (i == 1) {
          liquidityPool.token1 = reserveTokenResult.value.toHexString()
        }
      }
    }

    liquidityPool.save()
  }
}

export function handleConversionV1(event: ConversionEventV1): void {
  const transaction = createAndReturnTransaction(event)
  const liquidityPool = LiquidityPool.load(event.address.toHexString())
  const fromToken = Token.load(event.params._fromToken.toHexString())
  const toToken = Token.load(event.params._toToken.toHexString())

  if (liquidityPool !== null && fromToken !== null && toToken !== null) {
    handleConversion(
      {
        transaction: transaction,
        logIndex: event.logIndex,
        liquidityPool: liquidityPool,
        fromToken: fromToken,
        toToken: toToken,
        fromAmount: decimal.fromBigInt(event.params._amount, fromToken.decimals),
        toAmount: decimal.fromBigInt(event.params._return, toToken.decimals),
        trader: event.params._trader,
        user: event.transaction.from,
        conversionFee: decimal.fromBigInt(event.params._conversionFee, toToken.decimals),
        protocolFee: BigDecimal.zero(),
      },
      event,
    )
  }
}

export function handleConversionV2(event: ConversionEventV2): void {
  const transaction = createAndReturnTransaction(event)
  const liquidityPool = LiquidityPool.load(event.address.toHexString())
  const fromToken = Token.load(event.params._fromToken.toHexString())
  const toToken = Token.load(event.params._toToken.toHexString())

  if (liquidityPool !== null && fromToken !== null && toToken !== null) {
    handleConversion(
      {
        transaction: transaction,
        logIndex: event.logIndex,
        liquidityPool: liquidityPool,
        fromToken: fromToken,
        toToken: toToken,
        fromAmount: decimal.fromBigInt(event.params._amount, fromToken.decimals),
        toAmount: decimal.fromBigInt(event.params._return, toToken.decimals),
        trader: event.params._trader,
        user: event.transaction.from,
        conversionFee: decimal.fromBigInt(event.params._conversionFee, toToken.decimals),
        protocolFee: BigDecimal.zero(),
      },
      event,
    )
  }
}

export function handleConversionV1_2(event: ConversionEventV1WithProtocol): void {
  const transaction = createAndReturnTransaction(event)
  const liquidityPool = LiquidityPool.load(event.address.toHexString())
  const fromToken = Token.load(event.params._fromToken.toHexString())
  const toToken = Token.load(event.params._toToken.toHexString())

  if (liquidityPool !== null && fromToken !== null && toToken !== null) {
    handleConversion(
      {
        transaction: transaction,
        logIndex: event.logIndex,
        liquidityPool: liquidityPool,
        fromToken: fromToken,
        toToken: toToken,
        fromAmount: decimal.fromBigInt(event.params._amount, fromToken.decimals),
        toAmount: decimal.fromBigInt(event.params._return, toToken.decimals),
        trader: event.params._trader,
        user: event.transaction.from,
        conversionFee: decimal.fromBigInt(event.params._conversionFee, toToken.decimals),
        protocolFee: decimal.fromBigInt(event.params._protocolFee, toToken.decimals),
      },
      event,
    )
  }
}

function handleConversion(event: IConversionEvent, eth: ethereum.Event): void {
  createAndReturnConversion(event)
  /** 1. Load both tokens here */
  const parsedEvent: ConversionEventForSwap = {
    transaction: event.transaction,
    trader: event.trader,
    fromToken: event.fromToken,
    toToken: event.toToken,
    fromAmount: event.fromAmount,
    toAmount: event.toAmount,
    lpFee: event.conversionFee,
    protocolFee: event.protocolFee,
  }

  createAndReturnSwap(parsedEvent)
  updatePricing(parsedEvent)
  updateVolumes(parsedEvent, dataSource.address(), eth)
  updateCandleSticks(parsedEvent)

  incrementPoolBalance(event.liquidityPool, event.fromToken, event.fromAmount)
  decrementPoolBalance(event.liquidityPool, event.toToken, event.toAmount)

  incrementProtocolAmmTotals(event.toAmount, event.conversionFee, event.protocolFee, event.toToken)
  incrementUserAmmTotals(event.toAmount, event.conversionFee, event.protocolFee, event.toToken, event.user)
}

/** For debugging: Emitted from SOV pool at 2425895 */
export function handleWithdrawFees(event: WithdrawFeesEvent): void {
  const liquidityPool = LiquidityPool.load(event.address.toHexString())
  const token = Token.load(event.params.token.toHexString())
  if (liquidityPool !== null && token !== null) {
    const feeAmount = decimal.fromBigInt(event.params.protocolFeeAmount, token.decimals)
    decrementPoolBalance(liquidityPool, token, feeAmount)
  }
}
