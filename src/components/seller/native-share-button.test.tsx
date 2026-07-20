import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { NativeShareButton } from "./native-share-button";

describe("NativeShareButton", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("fetches the image and shares it as a file when the browser supports file sharing", async () => {
    const blob = new Blob(["fake-image-bytes"], { type: "image/png" });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ blob: () => Promise.resolve(blob) }),
    );
    const share = vi.fn().mockResolvedValue(undefined);
    const canShare = vi.fn().mockReturnValue(true);
    vi.stubGlobal("navigator", { ...navigator, canShare, share });

    render(
      <NativeShareButton
        fallbackUrl="https://snapduka.test/shop"
        imageFilename="story.png"
        imageUrl="/api/share/story-card"
        label="Share"
        text="Check this out"
        title="My Shop"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Share" }));

    await waitFor(() => expect(share).toHaveBeenCalledTimes(1));
    const payload = share.mock.calls[0][0];
    expect(payload.title).toBe("My Shop");
    expect(payload.text).toBe("Check this out");
    expect(payload.files).toHaveLength(1);
    expect(payload.files[0].name).toBe("story.png");
  });

  it("falls back to a text+link share when the browser can't share files", async () => {
    const blob = new Blob(["fake-image-bytes"], { type: "image/png" });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ blob: () => Promise.resolve(blob) }),
    );
    const share = vi.fn().mockResolvedValue(undefined);
    const canShare = vi.fn().mockReturnValue(false);
    vi.stubGlobal("navigator", { ...navigator, canShare, share });

    render(
      <NativeShareButton
        fallbackUrl="https://snapduka.test/shop"
        imageFilename="story.png"
        imageUrl="/api/share/story-card"
        text="Check this out"
        title="My Shop"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Share" }));

    await waitFor(() => expect(share).toHaveBeenCalledTimes(1));
    expect(share).toHaveBeenCalledWith({
      title: "My Shop",
      text: "Check this out",
      url: "https://snapduka.test/shop",
    });
  });

  it("shows the pending label while sharing and restores it afterward", async () => {
    const blob = new Blob(["fake-image-bytes"], { type: "image/png" });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ blob: () => Promise.resolve(blob) }),
    );
    let resolveShare: () => void = () => {};
    const share = vi.fn(() => new Promise<void>((resolve) => (resolveShare = resolve)));
    const canShare = vi.fn().mockReturnValue(true);
    vi.stubGlobal("navigator", { ...navigator, canShare, share });

    render(
      <NativeShareButton
        fallbackUrl="https://snapduka.test/shop"
        imageFilename="story.png"
        imageUrl="/api/share/story-card"
        pendingLabel="Preparing…"
        text="Check this out"
        title="My Shop"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Share" }));

    await waitFor(() => expect(screen.getByRole("button")).toHaveTextContent("Preparing…"));
    expect(screen.getByRole("button")).toBeDisabled();

    resolveShare();
    await waitFor(() => expect(screen.getByRole("button")).toHaveTextContent("Share"));
    expect(screen.getByRole("button")).not.toBeDisabled();
  });
});
