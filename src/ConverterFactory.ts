import {
  NewConverter as NewConverterEvent,
  OwnerUpdate as OwnerUpdateEvent
} from "../generated/ConverterFactory/ConverterFactory"
import { NewConverter, OwnerUpdate } from "../generated/schema"

import { loadTransaction } from './utils/Transaction'

export function handleNewConverter(event: NewConverterEvent): void {
  let entity = new NewConverter(
    event.transaction.hash.toHex() + "-" + event.logIndex.toString()
  )
  entity._type = event.params._type
  entity._converter = event.params._converter
  entity._owner = event.params._owner
  let transaction = loadTransaction(event)
  entity.transaction = transaction.id
  entity.save()
}

export function handleOwnerUpdate(event: OwnerUpdateEvent): void {
  let entity = new OwnerUpdate(
    event.transaction.hash.toHex() + "-" + event.logIndex.toString()
  )
  entity._prevOwner = event.params._prevOwner
  entity._newOwner = event.params._newOwner
  let transaction = loadTransaction(event)
  entity.transaction = transaction.id
  entity.save()
}
