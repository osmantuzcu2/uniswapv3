import { BigNumber, BigNumberish, ethers } from "ethers";
import { Pool } from "@uniswap/v3-sdk";
import { CurrencyAmount, Percent, Token, TradeType } from "@uniswap/sdk-core";
import { abi as IUniswapV3PoolABI } from "@uniswap/v3-core/artifacts/contracts/interfaces/IUniswapV3Pool.sol/IUniswapV3Pool.json";
import { abi as QuoterABI } from "@uniswap/v3-periphery/artifacts/contracts/lens/Quoter.sol/Quoter.json";
import { AlphaRouter, SwapRoute, SwapType } from "@uniswap/smart-order-router";
import dotenv from "dotenv";

dotenv.config();

const provider = new ethers.providers.JsonRpcProvider(process.env.PROVIDER_URL);
const POOL_ADDRESS = "YOUR_POOL_ADDRESS";
const QUOTER_ADDRESS = "0xb27308f9F90D607463bb33eA1BeBb41C27CE5AB6";
// console.log(IUniswapV3PoolABI);
const poolContract = new ethers.Contract(
  POOL_ADDRESS,
  IUniswapV3PoolABI,
  provider
);
const quoterContract = new ethers.Contract(QUOTER_ADDRESS, QuoterABI, provider);
const router = new AlphaRouter({ chainId: 5, provider });

const privateKey = process.env.PRIVATE_KEY as string;

const signer = new ethers.Wallet(privateKey, provider);
signer.connect(provider);

const V3_SWAP_ROUTER_ADDRESS = "0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45";

interface Immutables {
  factory: string;
  token0: string;
  token1: string;
  fee: number;
  tickSpacing: number;
  maxLiquidityPerTick: ethers.BigNumber;
}

interface State {
  liquidity: ethers.BigNumber;
  sqrtPriceX96: ethers.BigNumber;
  tick: number;
  observationIndex: number;
  observationCardinality: number;
  observationCardinalityNext: number;
  feeProtocol: number;
  unlocked: boolean;
}

async function getPoolImmutables() {
  const [factory, token0, token1, fee, tickSpacing, maxLiquidityPerTick] =
    await Promise.all([
      poolContract.factory(),
      poolContract.token0(),
      poolContract.token1(),
      poolContract.fee(),
      poolContract.tickSpacing(),
      poolContract.maxLiquidityPerTick(),
    ]);

  const immutables: Immutables = {
    factory,
    token0,
    token1,
    fee,
    tickSpacing,
    maxLiquidityPerTick,
  };
  return immutables;
}

async function getPoolState() {
  const [liquidity, slot] = await Promise.all([
    poolContract.liquidity(),
    poolContract.slot0(),
  ]);

  const PoolState: State = {
    liquidity,
    sqrtPriceX96: slot[0],
    tick: slot[1],
    observationIndex: slot[2],
    observationCardinality: slot[3],
    observationCardinalityNext: slot[4],
    feeProtocol: slot[5],
    unlocked: slot[6],
  };

  return PoolState;
}

async function createPoolInstance() {
  const [immutables, state] = await Promise.all([
    getPoolImmutables(),
    getPoolState(),
  ]);
  const TokenA = new Token(5, immutables.token0, 18, "mlx", "MLX test");
  const TokenB = new Token(5, immutables.token1, 18, "ETH", "Ether");
  return new Pool(
    TokenA,
    TokenB,
    immutables.fee,
    state.sqrtPriceX96.toString(),
    state.liquidity.toString(),
    state.tick
  );
}

function fetchPrices(pool: Pool) {
  return {
    mlxPrice: pool.token0Price,
    ethPrice: pool.token1Price,
  };
}

// Gets quote for swap token by amount e.g. current market price for input amount (100 eth for 1 btc)
async function getQuote(amount: BigNumberish, pool: Pool) {
  // real time market price
  return await quoterContract.callStatic.quoteExactInputSingle(
    pool.token0.address,
    pool.token1.address,
    pool.fee,
    amount,
    0 // FIXME: Research for real number
  );
}

async function createTrade(amount: BigNumberish) {
  const [immutables, state] = await Promise.all([
    getPoolImmutables(),
    getPoolState(),
  ]);

  const USER_ADDRESS = await signer.getAddress();

  const TokenA = new Token(5, immutables.token0, 18, "mlx", "MLX test");
  const TokenB = new Token(5, immutables.token1, 18, "ETH", "Ether");

  const route = (await router.route(
    CurrencyAmount.fromRawAmount(TokenA, amount.toString()),
    TokenB,
    TradeType.EXACT_INPUT,
    {
      type: SwapType.SWAP_ROUTER_02,
      recipient: USER_ADDRESS,
      slippageTolerance: new Percent(5, 100),
      deadline: Math.floor(Date.now() / 1000 + 1800),
    }
  )) as SwapRoute;

  const data = route.methodParameters?.calldata;

  const transaction = {
    data,
    to: V3_SWAP_ROUTER_ADDRESS,
    value: BigNumber.from(route.methodParameters?.value),
    from: USER_ADDRESS,
    gasPrice: BigNumber.from(route.gasPriceWei),
  };

  return await signer.sendTransaction(transaction);
}

// TODO: research constructor guard
async function main() {
  // const pool = await createPoolInstance(); // POOL Instance for calculations, if needed
  // const prices = fetchPrices(pool); // this is how we can check prices
  const amount = ethers.utils.parseEther("1000"); // change amount to swap different amounts
  const tx = await createTrade(amount);
  console.log(tx);
}

main();
