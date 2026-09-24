/**
 * model-viewer.d.ts — Type declaration for @google/model-viewer custom element.
 *
 * @google/model-viewer declares HTMLElementTagNameMap but NOT JSX.IntrinsicElements.
 * React 19 uses the React.JSX namespace, so we augment it here.
 */
import "react";

interface ModelViewerAttributes {
  src?: string;
  alt?: string;
  ar?: boolean;
  "camera-controls"?: boolean;
  "auto-rotate"?: boolean;
  "auto-rotate-delay"?: string | number;
  "shadow-intensity"?: string | number;
  "shadow-softness"?: string | number;
  "environment-image"?: string;
  "skybox-image"?: string;
  "ios-src"?: string;
  "quick-look-browsers"?: string;
  "ar-modes"?: string | string[];
  "ar-scale"?: string;
  "camera-orbit"?: string;
  "max-camera-orbit"?: string;
  "min-camera-orbit"?: string;
  "field-of-view"?: string;
  "max-field-of-view"?: string;
  "min-field-of-view"?: string;
  "interpolation-decay"?: string;
  "orbit-sensitivity"?: string;
  "touch-action"?: string;
  poster?: string;
  reveal?: string;
  loading?: string;
  "disable-zoom"?: boolean;
  "disable-pan"?: boolean;
  "disable-tap"?: boolean;
  exposure?: string;
  "rotation-per-second"?: string;
  orientation?: string;
  scale?: string;
  "interaction-prompt"?: string;
  "interaction-prompt-style"?: string;
  "interaction-prompt-threshold"?: string;
  "camera-target"?: string;
  bounds?: string;
  "bounds-align"?: string;
}

declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      "model-viewer": React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement> & ModelViewerAttributes,
        HTMLElement
      >;
    }
  }
}

declare global {
  namespace JSX {
    interface IntrinsicElements {
      "model-viewer": React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement> & ModelViewerAttributes,
        HTMLElement
      >;
    }
  }
}

export {};
