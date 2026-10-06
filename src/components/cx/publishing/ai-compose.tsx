"use client";

import { ImagePlus, Wand2 } from "lucide-react";
import { useState, useTransition } from "react";
import { composeFromPromptAction, generateImageAction } from "@/app/(app)/cx/publishing/actions";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Select, Textarea } from "@/components/ui/input";
import { pubChannel } from "@/lib/cx/publishing/core";

/** Prompt-based compose (text AI key) and image generation (image API key); each hidden behind a note when not configured. */
export function AiCompose({ brandId, channel, postType, textAi, imageAi, disabled, onText, onImage }: { brandId: string; channel: string; postType: string; textAi: boolean; imageAi: boolean; disabled: boolean; onText: (text: string, pollOptions: string[]) => void; onImage: (assetId: string) => void }) {
  const [open, setOpen] = useState<"text" | "image" | null>(null);
  const [prompt, setPrompt] = useState("");
  const [size, setSize] = useState("1024x1024");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  if (!textAi && !imageAi) return null;
  return (
    <>
      {textAi && (
        <Button size="sm" disabled={disabled} onClick={() => { setOpen("text"); setError(null); }}>
          <Wand2 className="h-3.5 w-3.5" /> Write from prompt
        </Button>
      )}
      {imageAi && (
        <Button size="sm" disabled={disabled} onClick={() => { setOpen("image"); setError(null); }}>
          <ImagePlus className="h-3.5 w-3.5" /> Generate image
        </Button>
      )}
      <Dialog
        open={!!open}
        onClose={() => setOpen(null)}
        size="lg"
        title={open === "image" ? "Generate an image" : `Write a ${pubChannel(channel)?.name ?? ""} post from a prompt`}
        description={open === "image" ? "The image is added to the asset library and attached to this post." : "Only facts from your prompt are used; review before scheduling."}
        error={error}
        onSubmit={() =>
          !pending &&
          prompt.trim() &&
          start(async () => {
            setError(null);
            if (open === "image") {
              const r = await generateImageAction(brandId, { prompt, size });
              if (!r.ok) return setError(r.error);
              if (r.data === null) return setError("No image API key is configured on the server.");
              onImage(r.data);
            } else {
              const r = await composeFromPromptAction(brandId, { prompt, channel, postType });
              if (!r.ok) return setError(r.error);
              if (r.data === null) return setError("No AI key is configured on the server.");
              onText(r.data.text, r.data.pollOptions);
            }
            setOpen(null);
            setPrompt("");
          })
        }
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(null)}>Cancel</Button>
            <Button type="submit" variant="primary" disabled={pending || !prompt.trim()} loading={pending}>
              {open === "image" ? "Generate" : "Write post"}
            </Button>
          </>
        }
      >
        <div className="grid gap-3">
          <Field label="Prompt" htmlFor="ai-prompt" hint={open === "image" ? "The image is tagged ai-generated. Review it before publishing." : undefined}>
            <Textarea id="ai-prompt" autoFocus rows={4} value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder={open === "image" ? "A bright flat-lay of autumn products on a wooden table, soft daylight" : "Announce our autumn guide for small businesses; friendly tone; link to the guide"} />
          </Field>
          {open === "image" && (
            <Field label="Size" htmlFor="ai-size">
              <Select id="ai-size" value={size} onChange={(e) => setSize(e.target.value)}>
                <option value="1024x1024">Square 1024×1024</option>
                <option value="1024x1536">Portrait 1024×1536</option>
                <option value="1536x1024">Landscape 1536×1024</option>
              </Select>
            </Field>
          )}
        </div>
      </Dialog>
    </>
  );
}
