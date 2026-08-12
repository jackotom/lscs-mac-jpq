import { fireEvent, screen } from "@testing-library/react";

export async function openWorkbench(): Promise<void> {
  fireEvent.click(await screen.findByRole("button", { name: "打开二级工作台" }));
}
