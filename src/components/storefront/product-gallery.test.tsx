import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ProductGallery, type VideoSlide } from "./product-gallery";

const YOUTUBE_VIDEO: VideoSlide = {
  provider: "youtube",
  videoId: "dQw4w9WgXcQ",
  videoUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  thumbnailUrl: "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
};

const OTHER_VIDEO: VideoSlide = {
  provider: "other",
  videoId: null,
  videoUrl: "https://example.com/watch",
  thumbnailUrl: null,
};

describe("ProductGallery", () => {
  it("renders the fallback gradient block when there is no media at all", () => {
    render(<ProductGallery images={[]} productName="Blue Sneakers" fallbackGradient="red" />);
    expect(screen.getByRole("img", { name: /photo coming soon/i })).toBeInTheDocument();
  });

  it("renders only photos when there is no video", () => {
    render(
      <ProductGallery
        images={["https://cdn.example.com/a.jpg", "https://cdn.example.com/b.jpg"]}
        productName="Blue Sneakers"
        fallbackGradient="red"
      />,
    );
    expect(screen.getByAltText("Blue Sneakers")).toHaveAttribute("src", "https://cdn.example.com/a.jpg");
    expect(screen.getAllByRole("tab")).toHaveLength(2);
  });

  it("shows the video as the first slide with a play button, before any photos", () => {
    render(
      <ProductGallery
        images={["https://cdn.example.com/a.jpg"]}
        video={YOUTUBE_VIDEO}
        productName="Blue Sneakers"
        fallbackGradient="red"
      />,
    );
    expect(screen.getByRole("button", { name: /play video for blue sneakers/i })).toBeInTheDocument();
    const tabs = screen.getAllByRole("tab");
    expect(tabs).toHaveLength(2);
    expect(tabs[0]).toHaveAttribute("aria-label", "Video");
  });

  it("swaps the video thumbnail for a same-origin-safe embed iframe on tap", async () => {
    const user = userEvent.setup();
    render(
      <ProductGallery images={[]} video={YOUTUBE_VIDEO} productName="Blue Sneakers" fallbackGradient="red" />,
    );

    await user.click(screen.getByRole("button", { name: /play video for blue sneakers/i }));

    const iframe = screen.getByTitle("Blue Sneakers video");
    expect(iframe.tagName).toBe("IFRAME");
    expect(iframe).toHaveAttribute(
      "src",
      "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?autoplay=1",
    );
  });

  it("opens the original link in a new tab for providers with no safe embed, instead of rendering an iframe", async () => {
    const user = userEvent.setup();
    const openSpy = vi.fn();
    vi.stubGlobal("open", openSpy);

    render(
      <ProductGallery images={[]} video={OTHER_VIDEO} productName="Blue Sneakers" fallbackGradient="red" />,
    );
    await user.click(screen.getByRole("button", { name: /play video for blue sneakers/i }));

    expect(openSpy).toHaveBeenCalledWith("https://example.com/watch", "_blank", "noopener,noreferrer");
    expect(screen.queryByTitle("Blue Sneakers video")).not.toBeInTheDocument();

    vi.unstubAllGlobals();
  });
});
