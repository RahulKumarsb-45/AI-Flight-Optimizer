'use client';

import { useState } from 'react';
import { Share2, Copy, Check, Ban } from 'lucide-react';
import { tripService } from '@/services/tripService';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Input } from '@/components/ui/Input';
import { useToast } from '@/components/ui/Toast';

/**
 * Share Trip button. Opens a modal that generates (or reuses) a public,
 * non-guessable link to this trip and lets the owner copy or revoke it.
 * Only rendered where the caller already knows the trip is theirs and
 * persisted (a `tripId`) — see TripDetailsContent / ResultsContent.
 */
function ShareTripButton({ tripId, className }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState('idle'); // idle | loading | ready | error
  const [shareUrl, setShareUrl] = useState('');
  const [copied, setCopied] = useState(false);
  const [revoking, setRevoking] = useState(false);

  if (!tripId) return null;

  async function handleOpen() {
    setOpen(true);
    setStatus('loading');
    setCopied(false);
    try {
      const { shareUrl: url } = await tripService.shareTrip(tripId);
      setShareUrl(url);
      setStatus('ready');
    } catch (err) {
      setStatus('error');
      toast({ variant: 'error', title: 'Could not create share link', description: err.message });
    }
  }

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      toast({ variant: 'error', title: 'Could not copy link', description: 'Select and copy it manually.' });
    }
  }

  async function handleRevoke() {
    setRevoking(true);
    try {
      await tripService.revokeShare(tripId);
      toast({ variant: 'info', title: 'Share link revoked', description: 'That link no longer works.' });
      setOpen(false);
    } catch (err) {
      toast({ variant: 'error', title: 'Could not revoke share link', description: err.message });
    } finally {
      setRevoking(false);
    }
  }

  return (
    <>
      <Button variant="outline" onClick={handleOpen} className={className}>
        <Share2 className="h-4 w-4" aria-hidden="true" /> Share Trip
      </Button>

      <Modal open={open} onClose={() => setOpen(false)} title="Share this trip">
        {/* aria-live announces the loading → ready/error transition to
            screen reader users, whose focus stays on the dialog itself
            while this content swaps in asynchronously. */}
        <div aria-live="polite">
          {status === 'loading' && <p className="py-2 text-sm text-ink-400">Generating your link…</p>}

          {status === 'error' && (
            <div className="space-y-3">
              <p className="text-sm text-danger-600">Something went wrong generating a share link.</p>
              <Button variant="outline" onClick={handleOpen}>
                Try again
              </Button>
            </div>
          )}

          {status === 'ready' && (
            <div className="space-y-4">
              <p className="text-sm text-ink-500">
                Anyone with this link can view a read-only copy of this trip — flights, dates, timeline, and any
                hotels, attractions, restaurants, and expense estimates. It never shares your account details.
              </p>
              <div className="flex items-center gap-2">
                <Input
                  readOnly
                  aria-label="Share link"
                  value={shareUrl}
                  onFocus={(e) => e.target.select()}
                  className="font-mono text-sm"
                />
                <Button onClick={handleCopy} aria-label="Copy share link">
                  {copied ? <Check className="h-4 w-4" aria-hidden="true" /> : <Copy className="h-4 w-4" aria-hidden="true" />}
                  {copied ? 'Copied' : 'Copy'}
                </Button>
              </div>
              <button
                onClick={handleRevoke}
                disabled={revoking}
                className="flex items-center gap-1.5 text-sm text-danger-600 hover:underline disabled:opacity-50"
              >
                <Ban className="h-3.5 w-3.5" aria-hidden="true" /> {revoking ? 'Revoking…' : 'Revoke this link'}
              </button>
            </div>
          )}
        </div>
      </Modal>
    </>
  );
}

export { ShareTripButton };
