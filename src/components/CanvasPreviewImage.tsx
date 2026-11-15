/* eslint-disable @next/next/no-img-element -- generated previews are already resized on the server */
'use client';
import { memo, useState, type ImgHTMLAttributes } from 'react';
import { previewImageUrl } from '@/lib/image-preview';

/** Preview loading/decoding never starts a generation request or blocks image tools. */
export default memo(function CanvasPreviewImage({ src = '', pixels, alt = '', className = '', ...props }: ImgHTMLAttributes<HTMLImageElement> & { pixels: number }) {
  const [failedPreview, setFailedPreview] = useState('');
  const [ready, setReady] = useState('');
  const [errorUrl, setErrorUrl] = useState<unknown>(null);
  const preview = typeof src === 'string' ? previewImageUrl(src,pixels) : src;
  const actual = failedPreview === preview ? src : preview;
  return <img {...props} alt={alt} className={`motif-preview ${className}`} data-media-source={src} data-media-ready={ready === actual} data-media-error={errorUrl === actual} src={actual} decoding="async" loading={props.loading || 'lazy'} onLoad={event => {
    const image = event.currentTarget; const loaded = actual;
    const show = () => { if (image.isConnected && image.getAttribute('src') === loaded && typeof loaded === 'string') setReady(loaded); };
    // Decoding cached images resolves without an artificial reveal delay.
    if (image.decode) void image.decode().then(show,show); else show();
    props.onLoad?.(event);
  }} onError={event => {
    if (typeof preview === 'string' && preview !== src && failedPreview !== preview) setFailedPreview(preview);
    else { setErrorUrl(actual); props.onError?.(event); }
  }}/>;
});
