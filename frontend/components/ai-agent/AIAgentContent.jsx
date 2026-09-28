'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Send, Sparkles, ArrowRight } from 'lucide-react';
import { aiService } from '@/services/aiService';
import { useToast } from '@/components/ui/Toast';
import { Button } from '@/components/ui/Button';
import { formatInr } from '@/utils/format';
import { cn } from '@/lib/utils';
import { trackAIAgentMessage } from '@/lib/analytics';

const STARTER_PROMPTS = [
  "I have ₹80,000 and want to see Europe",
  "I don't care about exact dates, just somewhere with beaches",
  "Planning a trip for 2 people, fastest option please",
];

function ExtractedSummary({ params }) {
  if (!params) return null;
  const chips = [];
  if (params.originCity) chips.push(`From ${params.originCity}`);
  if (params.destinationCountries?.length) chips.push(params.destinationCountries.join(', '));
  if (params.dateFlexible) chips.push('Flexible dates');
  else if (params.departureDate) chips.push(params.departureDate);
  if (params.travelers) chips.push(`${params.travelers} traveler${params.travelers > 1 ? 's' : ''}`);
  if (params.budgetInr) chips.push(formatInr(params.budgetInr));
  if (params.preference) chips.push(params.preference);

  if (chips.length === 0) return null;

  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {chips.map((chip, i) => (
        <span key={i} className="rounded-full bg-horizon-50 px-2.5 py-1 text-xs font-medium text-horizon-800">
          {chip}
        </span>
      ))}
    </div>
  );
}

function ChatBubble({ message }) {
  const isUser = message.role === 'user';
  return (
    <div className={cn('flex', isUser ? 'justify-end' : 'justify-start')}>
      <div
        className={cn(
          'max-w-[80%] rounded-xl px-4 py-2.5 text-sm leading-relaxed',
          isUser ? 'bg-horizon-700 text-white' : 'bg-ink-50 text-ink-800'
        )}
      >
        {/* Visual position (left/right) and color convey who's speaking to
            sighted users — a screen reader needs that said explicitly. */}
        <span className="sr-only">{isUser ? 'You said: ' : 'Shreya AI said: '}</span>
        {message.content}
        {!isUser && <ExtractedSummary params={message.structured_params} />}
      </div>
    </div>
  );
}

function AIAgentContent() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [conversationId, setConversationId] = useState(null);
  const [sending, setSending] = useState(false);
  const { toast } = useToast();
  const router = useRouter();
  const scrollRef = useRef(null);

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const latestParams = [...messages].reverse().find((m) => m.role === 'assistant')?.structured_params;

  async function handleSend(text) {
    const trimmed = text.trim();
    if (!trimmed || sending) return;

    setMessages((prev) => [...prev, { role: 'user', content: trimmed }]);
    setInput('');
    setSending(true);

    try {
      const result = await aiService.sendMessage({ message: trimmed, conversationId });
      setConversationId(result.conversationId);
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: result.reply, structured_params: result.extractedParams },
      ]);
      // Metadata only — the message/reply text itself is never sent to GA.
      trackAIAgentMessage({ action: 'send_message', success: true });
    } catch (err) {
      toast({ variant: 'error', title: "Could not send that", description: err.message });
      setMessages((prev) => prev.slice(0, -1));
      trackAIAgentMessage({ action: 'send_message', success: false });
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="flex h-full flex-col">
      {/* Persistent brand header — mirrors the homepage "Meet Shreya AI"
          preview card's figcaption (same avatar treatment, same name), so
          this standalone page reads as the same product whether or not a
          conversation has started yet. */}
      <div className="flex items-center gap-2.5 border-b border-ink-100 bg-white px-4 py-3 sm:px-8">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-horizon-700 text-white">
          <Sparkles className="h-4 w-4" aria-hidden="true" />
        </span>
        <span>
          <span className="block text-sm font-semibold text-ink-900">Shreya AI</span>
          <span className="block text-xs text-ink-400">Your AI travel copilot</span>
        </span>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-6 sm:px-8">
        {/* Capped at a comfortable reading width and centered, same idea as
            the homepage's content columns — otherwise chat bubbles would
            stretch edge-to-edge on wide desktop monitors. */}
        <div className="mx-auto w-full max-w-3xl space-y-4">
          {messages.length === 0 && (
            <div className="mx-auto max-w-md pt-10 text-center">
              <Sparkles className="mx-auto h-8 w-8 text-amber-500" aria-hidden="true" />
              <h1 className="mt-3 font-display text-xl text-ink-900">Hi, I&apos;m Shreya AI</h1>
              <p className="mt-1.5 text-sm text-ink-500">
                Tell me about your trip — I&apos;ll help figure out where, when, and how, then hand you
                off to search for real options.
              </p>
              <div className="mt-6 flex flex-col gap-2">
                {STARTER_PROMPTS.map((prompt) => (
                  <button
                    key={prompt}
                    onClick={() => handleSend(prompt)}
                    className="rounded-lg border border-ink-100 px-4 py-2.5 text-left text-sm text-ink-600 hover:border-horizon-200 hover:bg-horizon-50/40"
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* role="log" + aria-live: new messages (and the "Thinking..."
              status) are announced to screen reader users as they arrive,
              same as sighted users see them appear. */}
          <div role="log" aria-live="polite" aria-relevant="additions" className="space-y-4">
            {messages.map((m, i) => (
              <ChatBubble key={i} message={m} />
            ))}

            {sending && (
              <div className="flex justify-start">
                <div role="status" className="rounded-xl bg-ink-50 px-4 py-2.5 text-sm text-ink-400">
                  Thinking...
                </div>
              </div>
            )}
          </div>

          {latestParams?.readyToSearch && !sending && (
            <div className="mx-auto max-w-sm rounded-xl border border-amber-300 bg-amber-50 p-4 text-center">
              <p className="text-sm text-amber-900">Got enough to start searching!</p>
              <Button onClick={() => router.push('/search')} size="sm" className="mt-3">
                Continue to search <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
              </Button>
            </div>
          )}

          <div ref={scrollRef} />
        </div>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          handleSend(input);
        }}
        className="border-t border-ink-100 bg-white px-4 py-3 sm:px-8"
      >
        <div className="mx-auto flex w-full max-w-3xl items-center gap-2">
          <label htmlFor="ai-chat-input" className="sr-only">
            Message
          </label>
          <input
            id="ai-chat-input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Tell me where you want to go..."
            className="flex-1 rounded-full border border-ink-200 px-4 py-2.5 text-sm outline-none focus-visible:border-horizon-500"
            disabled={sending}
          />
          <button
            type="submit"
            disabled={sending || !input.trim()}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-horizon-700 text-white disabled:opacity-40"
            aria-label="Send message"
          >
            <Send className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </form>
    </div>
  );
}

export { AIAgentContent };
