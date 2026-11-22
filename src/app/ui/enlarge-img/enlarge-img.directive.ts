import {
  Directive,
  ElementRef,
  HostListener,
  inject,
  input,
  OnDestroy,
  Renderer2,
} from '@angular/core';
import { getCoords } from './get-coords';

const LARGE_IMG_ID = 'enlarged-img';

@Directive({ selector: '[enlargeImg]' })
export class EnlargeImgDirective implements OnDestroy {
  private _renderer = inject(Renderer2);
  private _el = inject(ElementRef);

  imageEl: HTMLElement;
  newImageEl?: HTMLElement;
  lightboxParentEl: HTMLElement = document.body;
  enlargedImgWrapperEl?: HTMLElement;
  isImg?: boolean;
  zoomMode: number = 0;
  zoomMoveHandler?: (ev: MouseEvent) => void;
  private _keydownHandler?: (ev: KeyboardEvent) => void;
  private _isClosing = false;

  readonly enlargeImg = input<string>();

  constructor() {
    this.imageEl = this._el.nativeElement;
  }

  ngOnDestroy(): void {
    this._removeKeydownListener();
    if (this.enlargedImgWrapperEl && this.zoomMoveHandler) {
      this.enlargedImgWrapperEl.removeEventListener('mousemove', this.zoomMoveHandler);
    }
    this.enlargedImgWrapperEl?.remove();
    this.enlargedImgWrapperEl = undefined;
  }

  @HostListener('click') onClick(): void {
    this.isImg = this.imageEl.tagName.toLowerCase() === 'img';

    if (this.isImg || this.enlargeImg()) {
      this._showImg();
    }
  }

  private _removeKeydownListener(): void {
    if (this._keydownHandler) {
      document.removeEventListener('keydown', this._keydownHandler, true);
      this._keydownHandler = undefined;
    }
  }

  private _hideImg(): void {
    if (this._isClosing || !this.enlargedImgWrapperEl) {
      return;
    }
    this._isClosing = true;
    this._removeKeydownListener();
    if (this.zoomMoveHandler) {
      this.enlargedImgWrapperEl.removeEventListener('mousemove', this.zoomMoveHandler);
      this.zoomMoveHandler = undefined;
    }
    const wrapperEl = this.enlargedImgWrapperEl;
    this._setOriginCoordsForImageAni();
    this._renderer.addClass(wrapperEl, 'ani-remove');
    this._renderer.removeClass(wrapperEl, 'ani-enter');
    const cleanup = (): void => {
      wrapperEl.remove();
      if (this.enlargedImgWrapperEl === wrapperEl) {
        this.enlargedImgWrapperEl = undefined;
      }
      this._isClosing = false;
    };
    wrapperEl.addEventListener('transitionend', cleanup, { once: true });
    // Fallback when animations are disabled or transitionend never fires
    window.setTimeout(cleanup, 300);
  }

  private _setOriginCoordsForImageAni(): void {
    if (!this.newImageEl) {
      throw new Error();
    }
    const origImgCoords = getCoords(this.imageEl);
    const newImageCoords = getCoords(this.newImageEl);
    const scale = this.imageEl.offsetWidth / this.newImageEl.offsetWidth || 0.01;
    const startLeft = origImgCoords.left - newImageCoords.left;
    const startTop = origImgCoords.top - newImageCoords.top;

    this._renderer.setStyle(
      this.newImageEl,
      'transform',
      `translate3d(${startLeft}px, ${startTop}px, 0) scale(${scale})`,
    );
  }

  private _showImg(): void {
    const src = this.enlargeImg() || (this.imageEl.getAttribute('src') as string);

    const img = new Image();
    img.src = src;
    img.onload = () => {
      this._setOriginCoordsForImageAni();
      this._waitForImgRender().then(() => {
        this._renderer.addClass(this.enlargedImgWrapperEl, 'ani-enter');
        this._renderer.setStyle(
          this.newImageEl,
          'transform',
          `translate3d(0, 0, 0) scale(1)`,
        );
      });
    };
    img.onerror = () => {
      this._hideImg();
    };

    this._isClosing = false;
    this.enlargedImgWrapperEl = this._htmlToElement(
      `<div class="enlarged-image-wrapper"></div>`,
    );
    const closeBtnEl = document.createElement('button');
    closeBtnEl.type = 'button';
    closeBtnEl.className = 'enlarged-image-close-btn';
    closeBtnEl.setAttribute('aria-label', 'Close');
    closeBtnEl.textContent = '×';
    closeBtnEl.addEventListener('click', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      this._hideImg();
    });
    // SECURITY: build the <img> via DOM properties, never innerHTML. `src` can
    // originate from synced/imported note data (note.imgUrl); interpolating it
    // into an HTML string let a crafted URL break out of the src attribute and
    // inject an event handler (stored DOM-XSS). See GHSA-78rv-m663-4fph.
    const newImageEl = document.createElement('img');
    newImageEl.src = src;
    newImageEl.className = 'enlarged-image';
    newImageEl.id = LARGE_IMG_ID;
    this.newImageEl = newImageEl;
    this._renderer.appendChild(this.enlargedImgWrapperEl, closeBtnEl);
    this._renderer.appendChild(this.enlargedImgWrapperEl, this.newImageEl);
    this._renderer.appendChild(this.lightboxParentEl, this.enlargedImgWrapperEl);
    this.zoomMode = 0;

    this._removeKeydownListener();
    this._keydownHandler = (ev: KeyboardEvent): void => {
      if (ev.key === 'Escape') {
        ev.preventDefault();
        ev.stopPropagation();
        this._hideImg();
      }
    };
    document.addEventListener('keydown', this._keydownHandler, true);
    this.enlargedImgWrapperEl.addEventListener('click', () => {
      if (this.zoomMode === 0) {
        this._hideImg();
      } else {
        (this.newImageEl as HTMLElement).addEventListener('transitionend', () => {
          setTimeout(() => {
            this._hideImg();
          });
        });
        this._zoomOutImg();
      }
    });
    (this.newImageEl as HTMLElement).addEventListener('click', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      if (this.zoomMode === 0) {
        this._zoomImg();
      } else {
        (this.newImageEl as HTMLElement).addEventListener('transitionend', () => {
          setTimeout(() => {
            this._hideImg();
          });
        });
        this._zoomOutImg();
      }
      this.zoomMode++;
    });
  }

  private _zoomImg(): void {
    if (!this.enlargedImgWrapperEl) {
      throw new Error();
    }
    this._renderer.addClass(this.enlargedImgWrapperEl, 'isZoomed');
    this._renderer.setStyle(
      this.newImageEl as HTMLElement,
      'transform',
      `scale(2) translate3d(-25%, -25%, 0)`,
    );
    this.zoomMoveHandler = this._zoom.bind(this);
    this.enlargedImgWrapperEl.addEventListener('mousemove', this.zoomMoveHandler as any);
  }

  private _zoomOutImg(): void {
    if (!this.enlargedImgWrapperEl || !this.zoomMoveHandler) {
      throw new Error();
    }
    this.enlargedImgWrapperEl.removeEventListener('mousemove', this.zoomMoveHandler);
    this._renderer.removeClass(this.enlargedImgWrapperEl, 'isZoomed');
    this._renderer.setStyle(
      this.newImageEl as HTMLElement,
      'transform',
      `scale(1) translate3d(0, 0, 0)`,
    );
  }

  private _htmlToElement(html: string): HTMLElement {
    const template = document.createElement('template');
    html = html.trim(); // Never return a text node of whitespace as the result
    template.innerHTML = html;
    return template.content.firstChild as HTMLElement;
  }

  private _zoom(e: MouseEvent): void {
    if (!this.enlargedImgWrapperEl) {
      throw new Error();
    }
    const offsetX = e.clientX;
    const offsetY = e.clientY;
    const zoomer = this.enlargedImgWrapperEl;
    const extra = 1.1;
    const magicSpace = 5;
    // prettier-ignore
    const x = ((offsetX / zoomer.offsetWidth * 100) - magicSpace) * (-0.5 * extra);
    // prettier-ignore
    const y = ((offsetY / zoomer.offsetHeight * 100) - magicSpace) * (-0.5 * extra);

    this._renderer.setStyle(
      this.newImageEl as HTMLElement,
      'transform',
      `scale(2) translate3d(${x}%, ${y}%, 0)`,
    );
  }

  private _waitForImgRender(): Promise<void> {
    const rafAsync = (): Promise<void> =>
      new Promise((resolve) => {
        requestAnimationFrame(() => resolve());
      });

    const checkElement = (id: string): Promise<void> => {
      const el = document.getElementById(id);
      if (el === null || !(el.offsetHeight > 1)) {
        return rafAsync().then(() => checkElement(id));
      } else {
        return Promise.resolve();
      }
    };

    return checkElement(LARGE_IMG_ID);
  }
}
