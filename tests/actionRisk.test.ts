import assert from "node:assert/strict";
import test from "node:test";
import { classifyActionTarget } from "../src/shared/actionRisk";

test("resolved submit semantics require a decision barrier even for opaque selectors", () => {
  assert.deepEqual(
    classifyActionTarget({
      tagName: "button",
      inputType: "submit",
      accessibleName: "Continue",
      id: "field-7",
      formAssociated: true,
    }),
    {
      actionRisk: "decision_barrier",
      actionRiskReason: "resolved target is a submit control",
      dataSensitivity: "ordinary",
    },
  );
});

test("resolved sensitive fields are detected from native type and autocomplete", () => {
  const password = classifyActionTarget({
    tagName: "input",
    inputType: "password",
    id: "field-7",
  });
  assert.equal(password.dataSensitivity, "sensitive");
  assert.match(password.dataSensitivityReason ?? "", /password control/);

  const otp = classifyActionTarget({
    tagName: "input",
    inputType: "text",
    autocomplete: "one-time-code",
    id: "field-8",
  });
  assert.equal(otp.dataSensitivity, "sensitive");
  assert.match(otp.dataSensitivityReason ?? "", /autocomplete/);
});

test("ordinary navigation controls remain eligible for task grants", () => {
  assert.deepEqual(
    classifyActionTarget({
      tagName: "button",
      inputType: "button",
      accessibleName: "Open details",
      id: "open-drawer",
    }),
    {
      actionRisk: "ordinary",
      dataSensitivity: "ordinary",
    },
  );
});
