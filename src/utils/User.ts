import { Address, BigInt } from '@graphprotocol/graph-ts'
import { User } from '../../generated/schema'

export function createAndReturnUser(address: Address): User {
  let userEntity = User.load(address.toHex())

  if (userEntity == null) {
    userEntity = new User(address.toHex())
    userEntity.numSwaps = 0
    userEntity.availableTradingRewards = BigInt.zero()
    userEntity.availableRewardSov = BigInt.zero()
  }

  userEntity.save()
  return userEntity
}
