export class ElementPickerUiTracker {
  private ownerTabId?: number;
  private invalidated = true;

  begin(ownerTabId?: number): void {
    this.ownerTabId = ownerTabId;
    this.invalidated = false;
  }

  finishStart(started: boolean, foregroundTabId?: number): boolean {
    if (
      !started ||
      this.invalidated ||
      (this.ownerTabId !== undefined &&
        foregroundTabId !== this.ownerTabId)
    ) {
      this.ownerTabId = undefined;
      this.invalidated = true;
      return false;
    }
    return true;
  }

  handleForegroundChanged(nextTabId: number): boolean {
    if (this.ownerTabId === undefined || this.ownerTabId === nextTabId) {
      return false;
    }
    this.ownerTabId = undefined;
    this.invalidated = true;
    return true;
  }

  complete(): void {
    this.ownerTabId = undefined;
    this.invalidated = true;
  }

  currentOwnerTabId(): number | undefined {
    return this.ownerTabId;
  }
}
