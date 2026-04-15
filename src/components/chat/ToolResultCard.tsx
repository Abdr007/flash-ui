"use client";

// ============================================
// Flash AI — Tool Result Card Router
// ============================================
// Thin dispatcher — all card implementations live in ./cards/

import { memo, useCallback } from "react";
import type { ToolPart, ToolOutput } from "./cards/types";
import { StreamingSteps, ToolError, GenericCard } from "./cards/shared";
import TradePreviewCard from "./cards/TradePreviewCard";
import ClosePreviewCard from "./cards/ClosePreviewCard";
import PositionsCard from "./cards/PositionsCard";
import PortfolioCard from "./cards/PortfolioCard";
import PriceCard from "./cards/PriceCard";
import MarketInfoCard from "./cards/MarketInfoCard";
import CollateralCard from "./cards/CollateralCard";
import ReversePositionCard from "./cards/ReversePositionCard";
import EarnDepositCard from "./cards/EarnDepositCard";
import EarnPoolsCard from "./cards/EarnPoolsCard";
import EarnPositionsCard from "./cards/EarnPositionsCard";
import EarnWithdrawCard from "./cards/EarnWithdrawCard";
import TransferPreviewCard from "./cards/TransferPreviewCard";
import TransferHistoryCard from "./cards/TransferHistoryCard";
import FafCard from "./cards/FafCard";
import ActionOptionsCard from "./cards/ActionOptionsCard";
import TransferPickerCard from "./cards/TransferPickerCard";
import TriggerOrderCard from "./cards/TriggerOrderCard";
import OrdersCard from "./cards/OrdersCard";
import OrderActionCard from "./cards/OrderActionCard";
import { ConvertFlpCard } from "./cards/ConvertFlpCard";
import { BurnSflpCard } from "./cards/BurnSflpCard";
import { MintSflpCard } from "./cards/MintSflpCard";
import WizardCard from "./WizardCard";

// ---- Wizard Tool Card (thin wrapper) ----
const WizardToolCard = memo(function WizardToolCard({
  output,
  onAction,
}: {
  output: ToolOutput;
  onAction?: (cmd: string) => void;
}) {
  const data = output.data as Record<string, unknown> | null;
  const commandTemplate = String(data?.commandTemplate ?? "");

  const handleComplete = useCallback(
    (answers: string[]) => {
      if (!onAction) return;
      let cmd = commandTemplate;
      answers.forEach((a, i) => {
        cmd = cmd.replace(`{${i}}`, a);
      });
      onAction(cmd);
    },
    [onAction, commandTemplate],
  );

  if (!data) return null;

  const intro = String(data.intro ?? "");
  const steps = (data.steps ?? []) as {
    question: string;
    options: string[];
    allowCustom?: boolean;
    customPlaceholder?: string;
  }[];

  if (steps.length === 0) return null;

  return <WizardCard intro={intro} steps={steps} onComplete={handleComplete} />;
});

// ---- Main Router ----
const ToolResultCard = memo(function ToolResultCard({
  part,
  onAction,
}: {
  part: ToolPart;
  onAction?: (cmd: string) => void;
}) {
  const output = part.output;

  if (part.state === "input-streaming") return <StreamingSteps toolName={part.toolName} step={1} input={part.input} />;
  if (part.state === "input-available") return <StreamingSteps toolName={part.toolName} step={2} input={part.input} />;
  if (!output) return <StreamingSteps toolName={part.toolName} step={2} input={part.input} />;
  if (output.status === "error" && !output.data) return <ToolError toolName={part.toolName} error={output.error} />;

  let card: React.ReactNode;
  switch (part.toolName) {
    case "build_trade":
      card = <TradePreviewCard output={output} onAction={onAction} />;
      break;
    case "close_position_preview":
      card = <ClosePreviewCard output={output} />;
      break;
    case "get_positions":
      card = <PositionsCard output={output} />;
      break;
    case "get_portfolio":
      card = <PortfolioCard output={output} />;
      break;
    case "get_price":
    case "get_all_prices":
      card = <PriceCard toolName={part.toolName} output={output} />;
      break;
    case "get_market_info":
      card = <MarketInfoCard output={output} />;
      break;
    case "add_collateral":
    case "remove_collateral":
      card = <CollateralCard output={output} />;
      break;
    case "reverse_position_preview":
      card = <ReversePositionCard output={output} />;
      break;
    case "earn_deposit":
      card = <EarnDepositCard output={output} />;
      break;
    case "earn_pools":
      card = <EarnPoolsCard output={output} onAction={onAction} />;
      break;
    case "earn_positions":
      card = <EarnPositionsCard output={output} />;
      break;
    case "earn_withdraw":
      card = <EarnWithdrawCard output={output} />;
      break;
    case "convert_flp_to_sflp":
      card = <ConvertFlpCard output={output} />;
      break;
    case "burn_sflp":
      card = <BurnSflpCard output={output} />;
      break;
    case "mint_sflp":
      card = <MintSflpCard output={output} />;
      break;
    case "transfer_preview":
      card = <TransferPreviewCard output={output} />;
      break;
    case "transfer_history":
      card = <TransferHistoryCard output={output} />;
      break;
    case "faf_dashboard":
    case "faf_stake":
    case "faf_unstake":
    case "faf_claim":
    case "faf_requests":
    case "faf_cancel_unstake":
    case "faf_tier":
      card = <FafCard toolName={part.toolName} output={output} onAction={onAction} />;
      break;
    case "action_options":
      card = <ActionOptionsCard output={output} onAction={onAction} />;
      break;
    case "wizard":
      card = <WizardToolCard output={output} onAction={onAction} />;
      break;
    case "transfer_picker":
      card = <TransferPickerCard output={output} onAction={onAction} />;
      break;
    case "place_trigger_order":
      card = <TriggerOrderCard output={output} />;
      break;
    case "get_orders":
      card = <OrdersCard output={output} />;
      break;
    case "cancel_limit_order":
    case "edit_limit_order":
    case "cancel_trigger_order":
      card = <OrderActionCard output={output} />;
      break;
    default:
      card = <GenericCard toolName={part.toolName} output={output} />;
      break;
  }

  return <div>{card}</div>;
});

export default ToolResultCard;
