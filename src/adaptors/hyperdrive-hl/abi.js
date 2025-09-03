module.exports = [
      {
        inputs: [],
        name: 'getMarketCount',
        outputs: [
            {
                internalType: 'uint256',
                name: '',
                type: 'uint256'
            }
        ],
        stateMutability: 'view',
        type: 'function'
    },
    {
    inputs: [
      {
        internalType: 'uint256',
        name: 'marketId',
        type: 'uint256'
      }
    ],
    name: 'getMarket',
    outputs: [
      {
        internalType: 'contract IMarket',
        name: '',
        type: 'address'
      }
    ],
    stateMutability: 'view',
    type: 'function'
  },
  {
    inputs: [
      {
        internalType: 'uint256',
        name: 'marketId',
        type: 'uint256'
      }
    ],
    name: 'getMarketQuery',
    outputs: [
      {
        components: [
          {
            internalType: 'address',
            name: 'marketAsset',
            type: 'address'
          },
          {
            internalType: 'string',
            name: 'marketAssetSymbol',
            type: 'string'
          },
          {
            internalType: 'uint8',
            name: 'marketAssetDecimals',
            type: 'uint8'
          },
          {
            internalType: 'uint256',
            name: 'maxSupply',
            type: 'uint256'
          },
          {
            internalType: 'uint256',
            name: 'totalShares',
            type: 'uint256'
          },
          {
            internalType: 'uint256',
            name: 'totalAssets',
            type: 'uint256'
          },
          {
            internalType: 'uint256',
            name: 'exchangeRate',
            type: 'uint256'
          },
          {
            internalType: 'uint256',
            name: 'totalReserveAssets',
            type: 'uint256'
          },
          {
            internalType: 'uint256',
            name: 'totalLiabilities',
            type: 'uint256'
          },
          {
            internalType: 'uint256',
            name: 'utilization',
            type: 'uint256'
          },
          {
            internalType: 'uint256',
            name: 'borrowRate',
            type: 'uint256'
          },
          {
            internalType: 'uint256',
            name: 'supplyRate',
            type: 'uint256'
          }
        ],
        internalType: 'struct IMarketLens.MarketQuery',
        name: '',
        type: 'tuple'
      }
    ],
    stateMutability: 'view',
    type: 'function'
  },
];
