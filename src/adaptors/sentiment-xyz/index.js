const axios = require('axios');
const sdk = require('@defillama/sdk');
const marketAbi = require('./abi.json');
const { formatChain } = require('../utils');
const { pool } = require('../rocifi-v2/abi');

const chain = 'hyperliquid';
const SENTIMENT_POOL = "0x36BFD6b40e2c9BbCfD36a6B1F1Aa65974f4fFA5D";
const RISK_ENGINE = "0xd22dE451Ba71fA6F06C65962649ba4E2Aea10863";
const SUPER_POOL_LENS = "0x40d42897cde0b2B242CE99399cf66Ed41EB8a917";

const BASE_POOL = [
    "14778331100793740007929971613900703995604470186100539494274894855699577891585", // HYPE
    "24340067792848736884157565898336136257613434225645880261054440301452940585526", // USDT0
    "35549059506791825930759374493305863417254935666006142339056302529054626325948"  // USDE
];

const SUPER_POOL = [
    "0x2831775cb5e64b1d892853893858a261e898fbeb", // HYPE
    "0x34B2B0DE7d288e79bbcfCEe6C2a222dAe25fF88D", // USDT0
    "0xe45E7272DA7208C7a137505dFB9491e330BF1a4e"  // USDE
]

const ASSETS = [
    "0x5555555555555555555555555555555555555555", // WHYPE
    "0x94e8396e0869c9F2200760aF0621aFd240E1CF38", // WSTHYPE
    "0xB8CE59FC3717ada4C02eaDF9682A9e934F625ebb", // USD₮0
    "0x5d3a1Ff2b6BAb83b63cd9AD0787074081a52ef34" // USDE
]

const getAbi = (name) => marketAbi.find((f) => f.name === name);

const RATE_DECIMALS = 1e16;
const PERCENTAGE_MULTIPLIER = 100;
const leverageCycles = 5;
const sumPow = (start, end, x) => {
    let s = 0;
    for (let i = start; i <= end; i++) s += Math.pow(x, i);
    return s;
};

const getLtvFor = async (poolId, assetAddress) => {
    try {
        const { output } = await sdk.api.abi.call({
            target: RISK_ENGINE,
            params: [poolId, assetAddress],
            abi: getAbi('ltvFor'),
            chain,
        });

        return output || 0;
    } catch (error) {
        console.error(`Error getting LTV for pool ${poolId} and asset ${assetAddress}:`, error);
        return 0;
    }
};

const callPoolView = async (fn, poolId, extraParams = []) => {
    try {
        const { output } = await sdk.api.abi.call({
            target: SENTIMENT_POOL,
            params: [poolId, ...extraParams],
            abi: getAbi(fn),
            chain,
        });
        return output || 0;
    } catch (e) {
        console.error(`Error calling ${fn} on pool ${SENTIMENT_POOL} with poolId ${poolId}:`, e);
        return 0;
    }
};

const callLensView = async (fn, poolId, extraParams = []) => {
    try {
        const { output } = await sdk.api.abi.call({
            target: SUPER_POOL_LENS,
            params: [poolId, ...extraParams],
            abi: getAbi(fn),
            chain,
        });
        return output || 0;
    } catch (e) {
        console.error(`Error calling ${fn} on lens ${SUPER_POOL_LENS} with poolId ${poolId}:`, e);
        return 0;
    }
};

const ERC20_SYMBOL_ABI = {
    name: 'symbol',
    inputs: [],
    outputs: [{ name: '', type: 'string' }],
    stateMutability: 'view',
    type: 'function',
};
const ERC20_DECIMALS_ABI = {
    name: 'decimals',
    inputs: [],
    outputs: [{ name: '', type: 'uint8' }],
    stateMutability: 'view',
    type: 'function',
};

const getSymbol = async (address) => {
    try {
        const { output } = await sdk.api.abi.call({
            target: address,
            abi: ERC20_SYMBOL_ABI,
            chain,
        });
        return String(output || '').toUpperCase();
    } catch (_) {
        return 'TOKEN';
    }
};

const getDecimals = async (address) => {
    try {
        const { output } = await sdk.api.abi.call({
            target: address,
            abi: ERC20_DECIMALS_ABI,
            chain,
        });
        return Number(output || 18);
    } catch (_) {
        return 18;
    }
};

const fetchPrices = async (tokens) => {
    const priceKeys = tokens.map((t) => `${chain}:${t}`).join(',');
    const url = `https://coins.llama.fi/prices/current/${priceKeys}`;
    const { data } = await axios.get(url);
    return data.coins || {};
};

const getApy = async () => {
    try {
        const pools = [];

        const poolAssets = await Promise.all(
            BASE_POOL.map((poolId) => callPoolView('getPoolAssetFor', poolId))
        );

        const [decimalsArr, symbolsArr] = await Promise.all([
            Promise.all(poolAssets.map((a) => getDecimals(a))),
            Promise.all(poolAssets.map((a) => getSymbol(a))),
        ]);

        const prices = await fetchPrices(poolAssets);

        for (let i = 0; i < BASE_POOL.length; i++) {
            const poolId = BASE_POOL[i];
            const asset = ASSETS[i];
            const decimals = decimalsArr[i] ?? 18;
            const symbol = symbolsArr[i];

            const [totalAssetsRaw, totalBorrowsRaw] = await Promise.all([
                callPoolView('getTotalAssets', poolId),
                callPoolView('getTotalBorrows', poolId),
            ]);

            const toNum = (x) => Number(x) / 10 ** decimals;
            const totalAssets = toNum(totalAssetsRaw);
            const totalBorrows = toNum(totalBorrowsRaw);

            const utilization = totalAssets > 0 ? Math.min(totalBorrows / totalAssets, 0.9999) : 0;

            const [supplyRateRaw, borrowRateRaw] = await Promise.all([
                callLensView('getPoolSupplyRate', poolId),
                callLensView('getPoolBorrowRate', poolId),
            ]);

            const supplyRate = Number(supplyRateRaw || 0) / RATE_DECIMALS;
            const borrowRate = Number(borrowRateRaw || 0) / RATE_DECIMALS;

            const sum0 = sumPow(0, leverageCycles, utilization);
            const sum1 = sumPow(1, leverageCycles, utilization);

            const apyBase = (supplyRate * sum0 - borrowRate * sum1) * PERCENTAGE_MULTIPLIER;
            const apyBaseBorrow = borrowRate * PERCENTAGE_MULTIPLIER;

            const priceKey = `${chain}:${asset}`;
            const price = prices[priceKey]?.price ?? 0;

            const totalSupplyUsd = totalAssets * price;
            const totalBorrowUsd = totalBorrows * price;
            const tvlUsd = Math.max(totalSupplyUsd - totalBorrowUsd, 0);

            const ltvRiskRaw = await getLtvFor(poolId, asset);

            pools.push({
                pool: `${poolId}/${asset}-${chain}`.toLowerCase(),
                chain: formatChain(chain),
                project: 'sentiment-xyz',
                symbol,
                tvlUsd,
                apyBase,
                apyBaseBorrow,
                totalSupplyUsd,
                totalBorrowUsd,
                underlyingTokens: [asset],
                ltv: ltvRiskRaw ? Number(ltvRiskRaw) / 1e18 : null,
                borrowable: Number(ltvRiskRaw) == 0 ? false : true,
                url: `https://app.sentiment.xyz/pools/${SUPER_POOL[i]}`,
                poolMeta: null,
            });
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
};