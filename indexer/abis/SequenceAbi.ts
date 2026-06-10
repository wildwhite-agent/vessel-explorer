export const SequenceAbi = [
  {
    type: 'function',
    name: 'balanceOf',
    inputs: [
      { name: 'account', type: 'address' },
      { name: 'id', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'tokens',
    inputs: [{ name: '', type: 'uint256' }],
    outputs: [
      { name: 'artist', type: 'string' },
      { name: 'artistAddress', type: 'address' },
      { name: 'maxSupply', type: 'uint256' },
      { name: 'price', type: 'uint256' },
      { name: 'minted', type: 'uint256' },
      { name: 'locked', type: 'bool' },
      { name: 'eventNumStart', type: 'uint256' },
      { name: 'eventNumEnd', type: 'uint256' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'uriData',
    inputs: [{ name: '', type: 'uint256' }],
    outputs: [
      { name: 'usesRenderer', type: 'bool' },
      { name: 'uri', type: 'string' },
      { name: 'renderer', type: 'address' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'vessel',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'event',
    name: 'TransferSingle',
    inputs: [
      { name: 'operator', type: 'address', indexed: true },
      { name: 'from', type: 'address', indexed: true },
      { name: 'to', type: 'address', indexed: true },
      { name: 'id', type: 'uint256', indexed: false },
      { name: 'value', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'TransferBatch',
    inputs: [
      { name: 'operator', type: 'address', indexed: true },
      { name: 'from', type: 'address', indexed: true },
      { name: 'to', type: 'address', indexed: true },
      { name: 'ids', type: 'uint256[]', indexed: false },
      { name: 'values', type: 'uint256[]', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'URI',
    inputs: [
      { name: 'value', type: 'string', indexed: false },
      { name: 'id', type: 'uint256', indexed: true },
    ],
  },
] as const
