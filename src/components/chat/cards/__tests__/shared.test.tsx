import { render, screen } from "@testing-library/react";
import { Cell, ToolError, TxSuccessCard, ConfidenceBadge, GenericCard } from "../shared";

describe("Cell", () => {
  it("renders label and value", () => {
    render(<Cell label="Price" value="$150.00" />);
    expect(screen.getByText("Price")).toBeInTheDocument();
    expect(screen.getByText("$150.00")).toBeInTheDocument();
  });

  it("applies custom color", () => {
    const { container } = render(<Cell label="PnL" value="+$50" color="green" />);
    const valueEl = container.querySelector(".num");
    expect(valueEl).toHaveStyle({ color: "rgb(0, 128, 0)" });
  });
});

describe("ToolError", () => {
  it("renders error message", () => {
    render(<ToolError toolName="test_tool" error="Something went wrong" />);
    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
  });

  it("renders default message when no error provided", () => {
    render(<ToolError toolName="test_tool" />);
    expect(screen.getByText("test_tool failed")).toBeInTheDocument();
  });

  it("has alert role for screen readers", () => {
    const { container } = render(<ToolError toolName="test" error="err" />);
    expect(container.querySelector("[role='alert']")).toBeInTheDocument();
  });
});

describe("TxSuccessCard", () => {
  it("renders success label", () => {
    render(<TxSuccessCard label="Trade executed" signature="abc123" />);
    expect(screen.getByText("Trade executed")).toBeInTheDocument();
  });

  it("renders Solscan link when signature provided", () => {
    render(<TxSuccessCard label="Done" signature="txsig123" />);
    const link = screen.getByText("View on Solscan →");
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute("href", "https://solscan.io/tx/txsig123");
  });

  it("does not render link when no signature", () => {
    render(<TxSuccessCard label="Done" signature={null} />);
    expect(screen.queryByText("View on Solscan →")).not.toBeInTheDocument();
  });

  it("has status role for screen readers", () => {
    const { container } = render(<TxSuccessCard label="Done" signature="x" />);
    expect(container.querySelector("[role='status']")).toBeInTheDocument();
  });
});

describe("GenericCard", () => {
  it("renders tool name and success", () => {
    render(<GenericCard toolName="my_tool" output={{ status: "success" }} />);
    expect(screen.getByText("my_tool: Done")).toBeInTheDocument();
  });

  it("renders error message", () => {
    render(<GenericCard toolName="my_tool" output={{ status: "error", error: "fail" }} />);
    expect(screen.getByText("my_tool: fail")).toBeInTheDocument();
  });
});

describe("ConfidenceBadge", () => {
  it("renders high confidence", () => {
    render(<ConfidenceBadge confidence={{ level: "high", score: 0.9, factors: [] }} />);
    expect(screen.getByText("Verified")).toBeInTheDocument();
  });

  it("renders low confidence", () => {
    render(<ConfidenceBadge confidence={{ level: "low", score: 0.3, factors: ["risky"] }} />);
    expect(screen.getByText("Low")).toBeInTheDocument();
  });
});
