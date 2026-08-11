/**
 * TooltipManager — Sleek custom tooltips for Astrid Sophia.
 * Integrates dynamic body-level tooltips to avoid clipping in overflow-hidden containers.
 */
export class TooltipManager {
  private static tooltipEl: HTMLElement | null = null;

  public static init(): void {
    if (typeof document === 'undefined') return;

    // Listen for mouseover to show tooltip (delegated)
    document.body.addEventListener('mouseover', (e) => {
      const target = e.target as HTMLElement;
      const tooltipTrigger = target.closest('[data-tooltip]');
      if (tooltipTrigger) {
        this.show(tooltipTrigger as HTMLElement);
      }
    });

    // Listen for mouseout to hide tooltip
    document.body.addEventListener('mouseout', (e) => {
      const target = e.target as HTMLElement;
      const tooltipTrigger = target.closest('[data-tooltip]');
      if (tooltipTrigger) {
        this.hide();
      }
    });

    // Also hide tooltip on click
    document.body.addEventListener('click', () => {
      this.hide();
    });
  }

  private static show(trigger: HTMLElement): void {
    const text = trigger.getAttribute('data-tooltip');
    if (!text) return;

    if (!this.tooltipEl) {
      this.tooltipEl = document.createElement('div');
      this.tooltipEl.className = 'premium-tooltip';
      document.body.appendChild(this.tooltipEl);
    }

    this.tooltipEl.textContent = text;
    this.tooltipEl.classList.add('visible');

    // Calculate positioning
    const triggerRect = trigger.getBoundingClientRect();
    const tooltipRect = this.tooltipEl.getBoundingClientRect();

    // Default position: above the element, centered
    let top = triggerRect.top - tooltipRect.height - 8;
    let left = triggerRect.left + (triggerRect.width - tooltipRect.width) / 2;

    // If it overflows the top of the screen, place it below the element
    if (top < 8) {
      top = triggerRect.bottom + 8;
    }

    // Keep it within screen horizontal bounds
    const maxLeft = window.innerWidth - tooltipRect.width - 8;
    if (left < 8) left = 8;
    if (left > maxLeft) left = maxLeft;

    this.tooltipEl.style.top = `${top + window.scrollY}px`;
    this.tooltipEl.style.left = `${left + window.scrollX}px`;
  }

  private static hide(): void {
    if (this.tooltipEl) {
      this.tooltipEl.classList.remove('visible');
    }
  }
}
