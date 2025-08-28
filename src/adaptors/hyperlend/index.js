const axios = require('axios');
const sdk = require('@defillama/sdk');

const utils = require('../utils');
const abi = require('./abi.json');

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
]

function calTotal(start, n, ltv) {
    let sum = 0;
    for (let i = start; i <= n; i++) {
        sum += Math.pow(ltv, i);
    }
    return sum;
}

async function get_lvt(tokenAddress) {
  const response = await sdk.api.abi.call({
    target: HYPERLEND_DATA_PROVIDER,
    abi: abi.getReserveConfigurationData,
    params: [tokenAddress],
    chain,  
  });

  return Number(response.output[1]); 
}

async function apy_stablecoin() {
    const apys = [];
    const maxLiquidityRate = 0.63; // example value
    const minBorrowRate = 0.99; // example value
    for (let i = 0; i < STABLECOIN.length; i++) {
        const ltv = await get_lvt(STABLECOIN[i]);
        const apy = await calc_apy_stablecoin(ltv, 5, maxLiquidityRate, minBorrowRate);
        apys.push(apy);
    }

    return apys;
}

async function calc_apy_stablecoin(ltv, n, maxLiquidityRate, minBorrowRate) {
    const ltvRatio = ltv / 10000;
    const sumLtvPow = calTotal(0, n, ltvRatio);
    const sumLtvPow1 = calTotal(1, n, ltvRatio);

    const apy = maxLiquidityRate * sumLtvPow - minBorrowRate * sumLtvPow1;

    return apy;
}

async function apy_uBase() {
    const apys = [];
    const maxLiquidityRate = 0.63; // example value
    const minBorrowRate = 0.99; // example value
    for (let i = 0; i < uBASE.length; i++) {
        const ltv = await get_lvt(uBASE[i]);
        const apy = await calc_apy_stablecoin(ltv, 5, maxLiquidityRate, minBorrowRate);
        apys.push(apy);
    }

    return apys;
}

async function getReverseData(dataProviderAddress) {
    const assets = []; 
    for (const asset of assets) {
        const result = await sdk.api.abi.call({
            target: dataProviderAddress,
            abi: abi.getReserveData,
            params: [asset.tokenAddress],
            chain,
        });

        const reserveData = result.output;
        asset.reserveData = {
            unbacked: reserveData[0] ? Number(reserveData[0]) / 1e18 : 0,
            accruedToTreasuryScaled: reserveData[1] ? Number(reserveData[1]) / 1e18 : 0,
            totalAToken: reserveData[2] ? Number(reserveData[2]) / 1e18 : 0,
            totalStableDebt: reserveData[3] ? Number(reserveData[3]) / 1e18 : 0,
            totalVariableDebt: reserveData[4] ? Number(reserveData[4]) / 1e18 : 0,
            liquidityRate: reserveData[5] ? Number(BigInt(reserveData[5]) / (BigInt(10) ** BigInt(18))) / 1e9 * 1e2 : 0,
            variableBorrowRate: reserveData[6] ? Number(BigInt(reserveData[6]) / (BigInt(10) ** BigInt(18))) / 1e9 * 1e2 : 0,
            stableBorrowRate: reserveData[7] ? Number(BigInt(reserveData[7]) / (BigInt(10) ** BigInt(18))) / 1e9 * 1e2 : 0,
            averageStableBorrowRate: reserveData[8] ? Number(BigInt(reserveData[8]) / (BigInt(10) ** BigInt(18))) / 1e9 * 1e2 : 0,
            liquidityIndex: reserveData[9] ? Number(reserveData[9]) / 1e27 : 0,
            variableBorrowIndex: reserveData[10] ? Number(reserveData[10]) / 1e27 : 0,
            lastUpdateTimestamp: reserveData[11] ? Number(reserveData[11]) : 0
        };
    }

    return assets;
}

async function calc_apy_uBase(ltv, n, liquidityRate, borrowRate) {
    const ltvRatio = ltv / 10000;
    const sumLtvPow = calTotal(0, n, ltvRatio);
    const sumLtvPow1 = calTotal(1, n, ltvRatio);

    const apy = liquidityRate * sumLtvPow - borrowRate * sumLtvPow1;

    return apy;
}

async function getAPY() {
    try {
        const pools = [];
        
        const stablecoinAPYs = await apy_stablecoin();
        for (let i = 0; i < STABLECOIN.length; i++) {
            pools.push({
                pool: STABLECOIN[i],
                chain: chain,
                project: 'hyperlend',
                symbol: `STABLECOIN-${i}`,
                apy: stablecoinAPYs[i] * 100, 
            });
        }

        const uBaseAPYs = await apy_uBase();
        for (let i = 0; i < uBASE.length; i++) {
            pools.push({
                pool: uBASE[i],
                chain: chain,
                project: 'hyperlend',
                symbol: `UBASE-${i}`,
                apy: uBaseAPYs[i] * 100, 
            });
        }

        return pools;
    } catch (error) {
        console.error('Error in getAPY:', error);
        return [];
    }
}

module.exports = {
    apy: getAPY,
};
