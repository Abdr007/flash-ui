// English translations (default)
export const en = {
  // Common
  common: {
    confirm: "Confirm",
    cancel: "Cancel",
    retry: "Try Again",
    loading: "Loading...",
    error: "Error",
    success: "Success",
    close: "Close",
    back: "Back",
    next: "Next",
    send: "Send",
    copy: "Copy",
    copied: "Copied",
  },

  // Portfolio
  portfolio: {
    totalBalance: "TOTAL BALANCE",
    readyToTrade: "Ready to trade",
    connectWallet: "Connect wallet to start",
    balanceUnavailable: "Balance unavailable",
    noPositions: "No Open Positions",
    startTrading: "Start trading to see your positions here.",
    pnl: "PnL",
    positions: "POSITIONS",
    netWorth: "NET WORTH",
    assets: "assets",
    viewMore: "View More",
    showLess: "Show Less",
  },

  // Trading
  trade: {
    confirmTrade: "Confirm Trade",
    cancelTrade: "Cancel",
    submitting: "Submitting...",
    tradeCancelled: "Trade cancelled.",
    tradeExecuted: "Trade executed",
    entry: "Entry",
    liquidation: "Liquidation",
    size: "Size",
    leverage: "Leverage",
    collateral: "Collateral",
    fees: "Fees",
    takeProfit: "Take Profit",
    stopLoss: "Stop Loss",
    liqDistance: "Liquidation distance",
    highLevWarning: "High leverage",
  },

  // Transfer
  transfer: {
    youAreSending: "YOU ARE SENDING",
    from: "From",
    to: "To",
    token: "Token",
    networkFee: "Network Fee",
    balanceImpact: "Balance Impact",
    recipientAddress: "Recipient Address",
    transferComplete: "Transfer Complete",
    transferFailed: "Transfer Failed",
    confirmTransfer: "Confirm Transfer",
    firstTimeSending: "First time sending to this address.",
  },

  // Earn
  earn: {
    earnPools: "Earn Pools — Live Data",
    noPoolsAvailable: "No Earn Pools Available",
    deposit: "DEPOSIT",
    withdraw: "WITHDRAW",
    apy: "APY",
    tvl: "TVL",
    flpPrice: "FLP Price",
    slippage: "Slippage",
    receive: "Receive",
    expectedFlp: "Expected FLP",
    noEarnPositions: "No Earn Positions",
    depositToStart: "Deposit USDC into a pool to start earning yield.",
  },

  // FAF
  faf: {
    startEarning: "Start Earning with FAF",
    stakedBalance: "staked balance",
    feeDiscount: "fee discount",
    earnings: "Earnings",
    fafRewards: "FAF rewards",
    usdcRevenue: "USDC revenue",
    rewardsWaiting: "Rewards waiting to be claimed",
    stakeFaf: "Stake FAF",
    claimRewards: "Claim Rewards",
    vipTiers: "VIP Tiers",
    unstake: "Unstake",
    requests: "Requests",
    confirmStake: "Confirm Stake",
    confirmUnstake: "Confirm Unstake (90-day lock)",
  },

  // Chat
  chat: {
    askAnything: "Ask anything...",
    executing: "Executing trade...",
    thinking: "Thinking...",
    sendMessage: "Send message",
  },

  // Errors
  errors: {
    walletNotConnected: "Connect your wallet to continue.",
    insufficientBalance: "Insufficient balance.",
    transactionFailed: "Transaction failed.",
    networkError: "Network error. Try again.",
    aiUnavailable: "AI temporarily unavailable. Try a direct command like 'long SOL $50 5x'.",
  },
} as const;

export type Translations = typeof en;
