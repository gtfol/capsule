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
import { uploadImageFromUrl } from "@/lib/upload";
import { Loader2 } from "lucide-react";

interface ImageUploadProps {
  onUploadComplete?: (url: string) => void;
}

const VALID_IMAGE_EXTENSIONS = [".jpg", ".jpeg", ".png", ".webp", ".gif"];

export function ImageUpload({ onUploadComplete }: ImageUploadProps) {
  const [imageUrl, setImageUrl] = useState<string>("");
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const validateUrl = (url: string): boolean => {
    try {
      new URL(url);
      const extension = url.toLowerCase().split(".").pop();
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
        "Please enter a valid image URL ending in .jpg, .jpeg, .png, .webp, or .gif"
      );
      return;
    }

    try {
      setError(null);
      setIsLoading(true);
      const blobUrl = await uploadImageFromUrl(imageUrl);
      onUploadComplete?.(blobUrl);
      handleClose();
    } catch (error) {
      if (error instanceof Error) {
        setError(error.message);
      } else {
        setError("Failed to upload image. Please check the URL and try again.");
      }
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
        <Button type="button" className="cursor-pointer">
          Add Image URL
        </Button>
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
