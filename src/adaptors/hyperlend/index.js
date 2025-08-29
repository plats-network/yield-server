const axios = require('axios');
const sdk = require('@defillama/sdk');
const poolAbi = require('./poolAbi');

const chain = 'hyperliquid';
const HYPERLEND_DATA_PROVIDER = "0x5481bf8d3946E6A3168640c1D7523eB59F055a29";

const STABLECOIN = [
    "0x5d3a1Ff2b6BAb83b63cd9AD0787074081a52ef34", // USDe
    "0xB8CE59FC3717ada4C02eaDF9682A9e934F625ebb", // USD₮0
    "0x211Cc4DD073734dA055fbF44a2b4667d5E5fE5d2", // sUSDe
    "0xb50A96253aBDF803D85efcDce07Ad8becBc52BD5", // USDHL
    "0x0aD339d66BF4AeD5ce31c64Bc37B3244b6394A77"  // USR
];

const uBASE = [
    "0x5555555555555555555555555555555555555555", // WHYPE
    "0x9FDBdA0A5e284c32744D2f17Ee5c74B284993463", // UBTC
    "0xBe6727B535545C67d5cAa73dEa54865B92CF7907"  // UETH
];

function calTotal(start, n, ltv) {
    let sum = 0;
    for (let i = start; i <= n; i++) {
        sum += Math.pow(ltv, i);
    }
    return sum;
}

const getApy = async () => {
    try {
        const protocolDataProvider = HYPERLEND_DATA_PROVIDER;
        
        const reserveTokens = (
            await sdk.api.abi.call({
                target: protocolDataProvider,
                abi: poolAbi.find(f => f.name === 'getAllReservesTokens'),
                chain,
            })
        ).output;
        
        console.log('Reserve tokens:', reserveTokens);

        const aTokens = (
            await sdk.api.abi.call({
                target: protocolDataProvider,
                abi: poolAbi.find(f => f.name === 'getAllATokens'),
                chain,
            })
        ).output;
        
        const poolsReserveData = (
            await sdk.api.abi.multiCall({
                calls: reserveTokens.map((p) => ({
                    target: protocolDataProvider,
                    params: p.tokenAddress,
                })),
                abi: poolAbi.find(f => f.name === 'getReserveData'),
                chain,
            })
        ).output.map((o) => o.output);

        const poolsReservesConfigurationData = (
            await sdk.api.abi.multiCall({
                calls: reserveTokens.map((p) => ({
                    target: protocolDataProvider,
                    params: p.tokenAddress,
                })),
                abi: poolAbi.find(f => f.name === 'getReserveConfigurationData'),
                chain,
            })
        ).output.map((o) => o.output);

        const totalSupply = (
            await sdk.api.abi.multiCall({
                chain,
                abi: 'erc20:totalSupply',
                calls: aTokens.map((t) => ({
                    target: t.tokenAddress,
                })),
            })
        ).output.map((o) => o.output);

        const underlyingBalances = (
            await sdk.api.abi.multiCall({
                chain,
                abi: 'erc20:balanceOf',
                calls: aTokens.map((t, i) => ({
                    target: reserveTokens[i].tokenAddress,
                    params: [t.tokenAddress],
                })),
            })
        ).output.map((o) => o.output);

        const underlyingDecimals = (
            await sdk.api.abi.multiCall({
                chain,
                abi: 'erc20:decimals',
                calls: aTokens.map((t) => ({
                    target: t.tokenAddress,
                })),
            })
        ).output.map((o) => o.output);

        const priceKeys = reserveTokens
            .map((t) => `${chain}:${t.tokenAddress}`)
            .join(',');
        const prices = (
            await axios.get(`https://coins.llama.fi/prices/current/${priceKeys}`)
        ).data.coins;

        console.log('Prices:', prices);

        return reserveTokens
            .map((pool, i) => {
                const frozen = poolsReservesConfigurationData[i].isFrozen;
                if (frozen) return null;

                const p = poolsReserveData[i];
                const configData = poolsReservesConfigurationData[i];
                const price = prices[`${chain}:${pool.tokenAddress}`]?.price;

                if (!price) {
                    console.log(`No price for ${pool.tokenAddress}`);
                    return null;
                }

                const supply = totalSupply[i];
                const totalSupplyUsd = (supply / 10 ** underlyingDecimals[i]) * price;

                const currentSupply = underlyingBalances[i];
                const tvlUsd = (currentSupply / 10 ** underlyingDecimals[i]) * price;
                const totalBorrowUsd = totalSupplyUsd - tvlUsd;

                const ltv = Number(configData.ltv);
                const liquidityRate = Number(p.liquidityRate) / 10 ** 27;
                const variableBorrowRate = Number(p.variableBorrowRate) / 10 ** 27;
                
                const ltvRatio = ltv / 10000;
                const n = 5;
                const sumLtvPow = calTotal(0, n, ltvRatio);
                const sumLtvPow1 = calTotal(1, n, ltvRatio);
                
                let calculatedAPY;
                
                if (STABLECOIN.includes(pool.tokenAddress)) {
                    // CURRENT HARD FIXED
                    const maxLiquidityRate = 0.63;
                    const minBorrowRate = 0.99;
                    calculatedAPY = maxLiquidityRate * sumLtvPow - minBorrowRate * sumLtvPow1;
                } else if (uBASE.includes(pool.tokenAddress)) {
                    calculatedAPY = liquidityRate * sumLtvPow - variableBorrowRate * sumLtvPow1;
                } else {
                    calculatedAPY = liquidityRate * sumLtvPow - variableBorrowRate * sumLtvPow1;
                }

                return {
                    pool: `${aTokens[i].tokenAddress}-${chain}`.toLowerCase(),
                    chain,
                    project: 'hyperlend',
                    symbol: pool.symbol,
                    tvlUsd,
                    apyBase: calculatedAPY * 100,
                    underlyingTokens: [pool.tokenAddress],
                    totalSupplyUsd,
                    totalBorrowUsd,
                    apyBaseBorrow: variableBorrowRate * 100,
                    ltv: ltvRatio,
                    url: 'https://hyperlend.finance',
                    borrowable: configData.borrowingEnabled,
                    poolMeta: 'HyperLend lending pool',
                };
            })
            .filter((i) => Boolean(i));
    } catch (error) {
        console.error('Error in getApy:', error);
        return [];
    }
};

module.exports = {
    timetravel: false,
    apy: getApy,
};