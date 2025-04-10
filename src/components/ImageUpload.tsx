import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, ImageIcon } from "lucide-react";
import Image from "next/image";

interface ImageUploadProps {
  onUploadComplete?: (url: string) => void;
}

const VALID_IMAGE_EXTENSIONS = [".jpg", ".jpeg", ".png", ".webp", ".gif"];

export function ImageUpload({ onUploadComplete }: ImageUploadProps) {
  const [imageUrl, setImageUrl] = useState<string>("");
  const [previewUrl, setPreviewUrl] = useState<string>("");
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const validateUrl = (url: string): boolean => {
    try {
      const urlObj = new URL(url);
      const pathname = urlObj.pathname;
      const extension = pathname.toLowerCase().split(".").pop();
      return extension
        ? VALID_IMAGE_EXTENSIONS.some((ext) => ext.includes(extension))
        : false;
    } catch {
      return false;
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!imageUrl) return;

    if (!validateUrl(imageUrl)) {
      setError(
        "Invalid image URL. Please use a direct link to a JPG, JPEG, PNG, WEBP, or GIF file"
      );
      return;
    }

    try {
      setIsLoading(true);
      const formData = new FormData();
      formData.append("imageUrl", imageUrl);

      const response = await fetch("/api/upload", {
        method: "POST",
        body: formData,
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to upload image");
      }

      onUploadComplete?.(data.url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to upload image");
    } finally {
      setIsLoading(false);
    }
  };

  const handleClose = () => {
    setIsOpen(false);
    setImageUrl("");
    setError(null);
  };

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) {
          handleClose();
        } else {
          setIsOpen(true);
        }
      }}
    >
      <DialogTrigger asChild>
        <div className="w-64 h-64 border-2 border-none rounded-none cursor-pointer hover:bg-gray-50/50 transition-colors">
          <div className="relative w-full h-full flex items-center justify-center">
            {previewUrl ? (
              <Image
                src={previewUrl}
                alt="Preview"
                fill
                className="object-cover"
              />
            ) : (
              <ImageIcon className="h-8 w-8 text-muted-foreground" />
            )}
          </div>
        </div>
      </DialogTrigger>
      <DialogContent className="rounded-none">
        <DialogHeader>
          <DialogTitle className="text-left">Add Image URL</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="imageUrl">Image URL</Label>
            <Input
              id="imageUrl"
              type="url"
              placeholder="https://example.com/image.jpg"
              value={imageUrl}
              onChange={(e) => {
                setImageUrl(e.target.value);
                setError(null);
              }}
              className="w-full"
              disabled={isLoading}
            />
            <p className="text-xs text-muted-foreground">
              Supported formats: JPG, JPEG, PNG, WEBP, GIF
            </p>
            {error && <p className="text-sm text-red-500">{error}</p>}
          </div>
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={handleClose}
              disabled={isLoading}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isLoading || !imageUrl}>
              {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {isLoading ? "Downloading..." : "Add Image"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
