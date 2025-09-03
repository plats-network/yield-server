const axios = require('axios');
const sdk = require('@defillama/sdk');
const marketAbi = require('./abi');

const chain = 'hyperliquid';
const HYPERDRIVE_MARKET_FACTORY = "0x954Acac906Bfc4E1461fb2c73606FCC35D85Dd1E";
const HYPERDRIVE_MARKET_LENS = "0x7fB0d63E84D847569ca75A6cdbA283bA1401F9f6";

// Market configurations
const MARKET_CONFIGS = {
    STABLECOIN: {
        addresses: [
            "0x5d3a1Ff2b6BAb83b63cd9AD0787074081a52ef34", // USDe
            "0xB8CE59FC3717ada4C02eaDF9682A9e934F625ebb", // USD₮0
            "0x211Cc4DD073734dA055fbF44a2b4667d5E5fE5d2", // sUSDe
            "0xb50A96253aBDF803D85efcDce07Ad8becBc52BD5", // USDHL
            "0x0aD339d66BF4AeD5ce31c64Bc37B3244b6394A77"  // USR
        ],
       
        poolMeta: 'hyperdrive stablecoin market'
    },
    uBASE: {
        addresses: [
            "0x5555555555555555555555555555555555555555", // WHYPE
            "0x9FDBdA0A5e284c32744D2f17Ee5c74B284993463", // UBTC
            "0xBe6727B535545C67d5cAa73dEa54865B92CF7907"  // UETH
        ],
        
        poolMeta: 'hyperdrive ubase market'
    }
};

const RATE_DECIMALS = 1e16;
const PERCENTAGE_MULTIPLIER = 100;

const calculateLeverageSum = (start, end, ltv) => {
    let sum = 0;
    for (let i = start; i <= end; i++) {
        sum += Math.pow(ltv, i);
    }
    return sum;
};

const getTokenPrice = async (tokenAddress) => {
    try {
        const priceKey = `${chain}:${tokenAddress}`;
        const response = await axios.get(`https://coins.llama.fi/prices/current/${priceKey}`);
        return response.data.coins[priceKey] || null;
    } catch (error) {
        console.error(`Error fetching price for ${tokenAddress}:`, error.message);
        return null;
    }
};

const calculateTvlUsd = (amount, tokenPrice) => {
    if (!tokenPrice || !amount) return 0;
    return (amount / Math.pow(10, tokenPrice.decimals)) * tokenPrice.price;
};

const getMarketCount = async () => {
    try {
        const result = await sdk.api.abi.call({
            target: HYPERDRIVE_MARKET_FACTORY,
            abi: marketAbi.find(f => f.name === 'getMarketCount'),
            chain,
        });
        return parseInt(result.output);
    } catch (error) {
        console.error('Error getting market count:', error);
        return 0;
    }
};

const getMarketQuery = async (marketId) => {
    try {
        const result = await sdk.api.abi.call({
            target: HYPERDRIVE_MARKET_LENS,
            params: [marketId],
            abi: marketAbi.find(f => f.name === 'getMarketQuery'),
            chain,
        });
        return result.output;
    } catch (error) {
        console.error(`Error getting market query for ID ${marketId}:`, error);
        return null;
    }
};

const getMarketType = (marketAddress) => {
    if (MARKET_CONFIGS.STABLECOIN.addresses.includes(marketAddress)) {
        return 'STABLECOIN';
    }
    if (MARKET_CONFIGS.uBASE.addresses.includes(marketAddress)) {
        return 'uBASE';
    }
    return null;
};

const calculateStablecoinAPY = (marketData) => {
    const maxLiquidityRate = 0.63;
    const minBorrowRate = 0.99;
    const ltv = marketData.totalLiabilities / marketData.totalAssets || 0;
    const leverageCycles = 5;
    const sumLtvPow = calculateLeverageSum(0, leverageCycles, ltv);
    const sumLtvPow1 = calculateLeverageSum(1, leverageCycles, ltv);
    return (maxLiquidityRate * sumLtvPow - minBorrowRate * sumLtvPow1) * PERCENTAGE_MULTIPLIER;
};

const calculateUBaseAPY = (marketData) => {
    const supplyRate = (marketData.supplyRate || 0) / RATE_DECIMALS;
    const borrowRate = (marketData.borrowRate || 0) / RATE_DECIMALS;
    const ltv = marketData.totalLiabilities / marketData.totalAssets || 0;
    const leverageCycles = 5;

    const sumLtvPow = calculateLeverageSum(0, leverageCycles, ltv);
    const sumLtvPow1 = calculateLeverageSum(1, leverageCycles, ltv);
    return (supplyRate * sumLtvPow - borrowRate * sumLtvPow1) * PERCENTAGE_MULTIPLIER;
};

const createPoolObject = async (marketData, marketType, marketAddress) => {
    const config = MARKET_CONFIGS[marketType];
    const tokenPrice = await getTokenPrice(marketAddress);
    const ltv = marketData.totalLiabilities / marketData.totalAssets || 0;

    const basePool = {
        pool: `${marketAddress}-${chain}`.toLowerCase(),
        chain,
        project: 'hyperdrive-hl',
        symbol: marketData.marketAssetSymbol || 'Unknown',
        underlyingTokens: [marketAddress],
        url: 'https://app.hyperdrive.fi/borrow',
        borrowable: true,
        poolMeta: config.poolMeta,
        ltv: ltv,
    };

    if (marketType === 'STABLECOIN') {
        return {
            ...basePool,
            tvlUsd: calculateTvlUsd(marketData.totalAssets, tokenPrice),
            apyBase: calculateStablecoinAPY(marketData),
            totalSupplyUsd: calculateTvlUsd(marketData.totalAssets, tokenPrice),
            totalBorrowUsd: calculateTvlUsd(marketData.totalLiabilities, tokenPrice),
            apyBaseBorrow: ((marketData.borrowRate || 0) / RATE_DECIMALS) * PERCENTAGE_MULTIPLIER,
        };
    } else if (marketType === 'uBASE') {
        return {
            ...basePool,
            tvlUsd: calculateTvlUsd(marketData.totalAssets, tokenPrice),
            apyBase: calculateUBaseAPY(marketData),
            totalSupplyUsd: calculateTvlUsd(marketData.totalAssets, tokenPrice),
            totalBorrowUsd: calculateTvlUsd(marketData.totalLiabilities, tokenPrice),
            apyBaseBorrow: ((marketData.borrowRate || 0) / RATE_DECIMALS) * PERCENTAGE_MULTIPLIER,
        };
    }

    return null;
};

const getApy = async () => {
    try {
        const marketCount = await getMarketCount();
        const pools = [];

        for (let i = 0; i < marketCount; i++) {
            try {
                const marketData = await getMarketQuery(i);
                if (!marketData) continue;

                const marketAddress = marketData.marketAsset;
                const marketType = getMarketType(marketAddress);

                if (!marketType) {
                    continue;
                }

                const pool = await createPoolObject(marketData, marketType, marketAddress);
                if (pool) {
                    pools.push(pool);
                }
            } catch (error) {
                console.error(`Error processing market ${i}:`, error);
                continue;
            }
        }

        return pools;
    } catch (error) {
        console.error('Error in getApy:', error);
        return [];
    }
};

module.exports = {
    timetravel: false,
    apy: getApy,
    url: 'https://app.hyperdrive.fi'
};