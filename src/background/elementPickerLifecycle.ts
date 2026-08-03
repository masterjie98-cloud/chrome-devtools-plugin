export interface ElementPickerBinding {
  tabId: number;
  frameId: number;
  documentId?: string;
}

/**
 * The picker lives inside one content-script document, while its control lives
 * in the persistent Side Panel. Keep the exact document binding so a foreground
 * Tab change can cancel the old picker instead of leaving the Side Panel in a
 * false "selecting" state or forwarding cancellation to the new Tab.
 */
export class ElementPickerBindingTracker {
  private activeBinding?: ElementPickerBinding;

  remember(binding: ElementPickerBinding): void {
    this.activeBinding = { ...binding };
  }

  current(): ElementPickerBinding | undefined {
    return this.activeBinding ? { ...this.activeBinding } : undefined;
  }

  take(): ElementPickerBinding | undefined {
    const binding = this.current();
    this.activeBinding = undefined;
    return binding;
  }

  takeWhenForegroundChanges(nextTabId: number): ElementPickerBinding | undefined {
    if (!this.activeBinding || this.activeBinding.tabId === nextTabId) {
      return undefined;
    }
    return this.take();
  }

  takeWhenDocumentInvalidates(tabId: number): ElementPickerBinding | undefined {
    if (this.activeBinding?.tabId !== tabId) {
      return undefined;
    }
    return this.take();
  }

  completeFromContent(
    tabId: number,
    frameId: number,
    documentId?: string,
  ): boolean {
    const binding = this.activeBinding;
    if (
      !binding ||
      binding.tabId !== tabId ||
      binding.frameId !== frameId ||
      (binding.documentId &&
        documentId &&
        binding.documentId !== documentId)
    ) {
      return false;
    }
    this.activeBinding = undefined;
    return true;
  }
}

export const elementPickerBindingTracker = new ElementPickerBindingTracker();
