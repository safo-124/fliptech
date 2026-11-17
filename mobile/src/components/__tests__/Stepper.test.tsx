import { fireEvent, render } from "@testing-library/react-native";

import { Stepper } from "../market/Stepper";

describe("the stepper", () => {
  it("stops at 1 and at what is left", async () => {
    const onChange = jest.fn();
    const view = await render(<Stepper value={1} max={3} onChange={onChange} />);

    expect(view.getByLabelText("One fewer").props.accessibilityState).toEqual({ disabled: true });
    fireEvent.press(view.getByLabelText("One more"));
    expect(onChange).toHaveBeenCalledWith(2);

    await view.rerender(<Stepper value={3} max={3} onChange={onChange} />);
    expect(view.getByLabelText("One more").props.accessibilityState).toEqual({ disabled: true });
    expect(view.getByLabelText("One fewer").props.accessibilityState).toEqual({ disabled: false });
  });
});

