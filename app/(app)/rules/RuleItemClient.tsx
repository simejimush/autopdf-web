"use client";

import { useState } from "react";
import RunButton from "./RunButton";

export default function RuleItemClient({
  rule,
  disabled,
}: {
  rule: { id: string };
  disabled?: boolean;
}) {
  const [running, setRunning] = useState(false);

  return (
    <>
      <RunButton ruleId={rule.id} disabled={disabled ?? false} />
    </>
  );
}
