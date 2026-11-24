/// <reference types="vite/client" />
// Sound encoding for browsers that have none built in (Firefox, older Safari). Runs on the device.
import { registerAacEncoder } from '@mediabunny/aac-encoder';
// Served as a file, so the page does not have to allow code made from text.
import workerUrl from '../../node_modules/@mediabunny/aac-encoder/dist/bundles/mediabunny-aac-encoder.worker.js?url';

let added = false;

export function addAacEncoder(): void {
  if (added) return;
  added = true;
  Object.assign(globalThis, { [Symbol.for('@mediabunny/aac-encoder:workerUrl')]: new URL(workerUrl, location.href) });
  registerAacEncoder();
}
