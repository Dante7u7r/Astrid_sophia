import { describe, expect, test } from "vitest";
import {
  parseBuzzerActuatorModel,
  parseLampActuatorModel,
  parseRelayActuatorModel,
} from "./actuator_helpers";

describe("modelos de actuadores", () => {
  test("distingue mega de mili en valores de ingenieria", () => {
    const relay = parseRelayActuatorModel(
      "80m;rcoil=120;pull=30m;hold=16m;ron=50m;roff=100Meg",
    );

    expect(relay.inductanceHenrys).toBeCloseTo(0.08);
    expect(relay.pullInCurrentAmps).toBeCloseTo(0.03);
    expect(relay.contactClosedResistanceOhms).toBeCloseTo(0.05);
    expect(relay.contactOpenResistanceOhms).toBeCloseTo(100e6);
  });

  test("acepta modelos explicitos de lampara y buzzer", () => {
    const lamp = parseLampActuatorModel(
      "120;rhot=120;rcold=26.4;vnom=12;pnom=1.2",
    );
    const buzzer = parseBuzzerActuatorModel(
      "90;ron=65;roff=252;vnom=5;vstart=1.1;tone=2400",
    );

    expect(lamp).toMatchObject({
      coldResistanceOhms: 26.4,
      hotResistanceOhms: 120,
      nominalVoltageVolts: 12,
      nominalPowerWatts: 1.2,
    });
    expect(buzzer).toMatchObject({
      baseResistanceOhms: 90,
      activeResistanceOhms: 65,
      inactiveResistanceOhms: 252,
      nominalVoltageVolts: 5,
      resonantFrequencyHz: 2400,
    });
  });
});
