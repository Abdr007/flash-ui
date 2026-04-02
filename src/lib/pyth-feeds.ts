// ============================================
// Flash UI — Pyth Feed ID Registry
// ============================================
// Source: flash-sdk PoolConfig.json (authoritative)
// Maps market symbols to Pyth Hermes price feed IDs

export const PYTH_FEED_IDS: Record<string, string> = {
  SOL: "0xef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d",
  BTC: "0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43",
  ETH: "0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace",
  BNB: "0x2f95862b045670cd22bee3114c39763a4a08beeb663b145d283c31d7d1101c4f",
  ZEC: "0xbe9b59d178f0d6a97ab4c343bff2aa69caa1eaae3e9048a65788c529b125bb24",
  XAU: "0x765d2ba906dbc32ca17cc11f5310a89e9ee1f6420508c63861f2f8ba4ee34bb2",
  JUP: "0x0a0408d619e9380abad35060f9192039ed5042fa6f82301d0e48bb52be830996",
  PYTH: "0x0bbf28e9a841a1cc788f6a361b17ca072d0ea3098a1e5df1c3922d06719579ff",
  JTO: "0xb43660a5f790c69354b0729a5ef9d50d68f1df92107540210b9cccba1f947cc2",
  RAY: "0x91568baa8beb53db23eb3fb7f22c6e8bd303d103919e19733f2bb642d3e7987a",
  BONK: "0x72b021217ca3fe68922a19aaf990109cb9d84e9ad004b4d2025ad6f529314419",
  PENGU: "0xbed3097008b9b5e3c93bec20be79cb43986b85a996475589351a21e67bae9b61",
  WIF: "0x4ca4beeca86f0d164160323817a4e42b10010a724c2217c6ee41b54cd4cc61fc",
  FARTCOIN: "0x58cd29ef0e714c5affc44f269b2c1899a52da4169d7acc147b9da692e6953608",
  ORE: "0x142b804c658e14ff60886783e46e5a51bdf398b4871d9d8f7c28aa1585cad504",
  HYPE: "0x4279e31cc369bbcc2faf022b382b080e32a8e689ff20fbc530d2a603eb6cd98b",
  SPY: "0x19e09bb805456ada3979a7d1cbb4b6d63babc3a0f8e8a9509f68afa5c4c11cd5",
  NVDA: "0xb1073854ed24cbc755dc527418f52b7d271f6cc967bbf8d8129112b18860a593",
  TSLA: "0x16dad506d7db8da01c87581c87ca897a012a153557d4d578c3b9c9e1bc0632f1",
  AAPL: "0x49f6b65cb1de6b10eaf75e7c03ca029c306d0357e91b5311b175084a5ad55688",
  AMD: "0x3622e381dbca2efd1859253763b1adc63f7f9abb8e76da1aa8e638a57ccde93e",
  AMZN: "0xb5d0e0fa58a1f8b81498ae670ce93c872d14434b72c364885d4fa1b257cbb07a",
};

// Reverse map: feed ID → symbol (for SSE parsing)
export const FEED_TO_SYMBOL: Record<string, string> = {};
for (const [symbol, feedId] of Object.entries(PYTH_FEED_IDS)) {
  // Store without 0x prefix for matching against SSE data
  FEED_TO_SYMBOL[feedId.replace("0x", "")] = symbol;
}

export const HERMES_SSE_URL = "https://hermes.pyth.network/v2/updates/price/stream";
