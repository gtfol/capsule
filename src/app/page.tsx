"use client";

import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Import, Trash2, Scissors, XCircle, RefreshCw } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { ImageUpload } from "@/components/ImageUpload";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

interface WardrobeItem {
  name: string;
  owned: boolean;
  color: string;
  seasons: string[];
  priority?: string;
  brand?: string;
  size?: string;
  tailored?: boolean;
  imageUrl?: string;
}

interface CategoryItems {
  [category: string]: WardrobeItem[];
}

interface WardrobeData {
  [location: string]: CategoryItems;
}

const categoryIcons: Record<string, string> = {
  Tops: "👕",
  Bottoms: "👖",
  Outerwear: "🧥",
  Footwear: "👟",
  Accessories: "🕶",
};

export default function Home() {
  const categories = [
    "Tops",
    "Bottoms",
    "Outerwear",
    "Footwear",
    "Accessories",
  ];

  const wardrobeViews = ["Guide", "My Wardrobe"];

  const initialWardrobe: WardrobeData = {
    Guide: {},
    "My Wardrobe": {
      Tops: [
        {
          name: "Ribbed Vest",
          owned: true,
          color: "Black",
          brand: "BOILER ROOM",
          size: "M",
          seasons: ["Spring", "Summer", "Fall", "Winter"],
        },
        {
          name: "Tank Top",
          owned: true,
          color: "Black",
          brand: "Falari",
          size: "M",
          seasons: ["Spring", "Summer", "Fall", "Winter"],
        },
        {
          name: "Tank Top",
          owned: true,
          color: "Gray",
          brand: "Falari",
          size: "M",
          seasons: ["Spring", "Summer", "Fall", "Winter"],
        },
        {
          name: "Tank Top",
          owned: true,
          color: "White",
          brand: "Falari",
          size: "M",
          seasons: ["Spring", "Summer", "Fall", "Winter"],
        },
        {
          name: "Oversized Dress Shirt",
          owned: true,
          color: "White",
          brand: "Fanjiuniu",
          size: "L",
          seasons: ["Spring", "Summer"],
        },
        {
          name: "Patched Oversized Sweatshirt",
          owned: true,
          color: "Black",
          brand: "Professor.E",
          size: "L",
          seasons: ["Spring", "Fall", "Winter"],
        },
        {
          name: "Distressed Sweater",
          owned: true,
          color: "Dark Gray",
          brand: "anonymous talking:",
          size: "L",
          seasons: ["Fall", "Winter"],
        },
        {
          name: "Turtleneck Long Sleeve Tee",
          owned: true,
          color: "Black",
          brand: "ionism",
          size: "M",
          seasons: ["Spring", "Fall", "Winter"],
        },
        {
          name: "Oversized Long-Sleeve Tee",
          owned: false,
          color: "Earth Tone",
          priority: "High",
          brand: "Needles",
          seasons: ["Spring", "Summer", "Fall", "Winter"],
        },
        {
          name: "Striped Oversized Sweater",
          owned: false,
          color: "Gray/Black",
          priority: "Medium",
          brand: "Kapital",
          seasons: ["Winter"],
        },
        {
          name: "Loose Fit Button-Up",
          owned: false,
          color: "Cream",
          priority: "Medium",
          brand: "Evan Kinori",
          seasons: ["Spring", "Summer", "Fall", "Winter"],
        },
        {
          name: "Loose Fit Button-Up",
          owned: false,
          color: "Washed Black",
          priority: "Medium",
          brand: "Engineered Garments",
          seasons: ["Spring", "Summer", "Fall", "Winter"],
        },
        {
          name: "Oversized T-Shirt",
          owned: false,
          color: "Black",
          priority: "High",
          brand: "Lady White Co.",
          seasons: ["Summer"],
        },
        {
          name: "Oversized T-Shirt",
          owned: false,
          color: "White",
          priority: "High",
          brand: "UNIQLO U",
          seasons: ["Summer"],
        },
        {
          name: "Loose Fit Linen Shirt",
          owned: false,
          color: "Natural",
          priority: "Medium",
          brand: "Story MFG",
          seasons: ["Summer"],
        },
      ],
      Bottoms: [
        {
          name: "Nylon Wide Leg Pants",
          owned: true,
          color: "Black",
          brand: "WISDOM",
          size: "31x28",
          seasons: ["Spring", "Summer", "Fall", "Winter"],
        },
        {
          name: "Wide Leg Pants w/ Zipper & Buttons",
          owned: true,
          color: "Black",
          brand: "CATSSTAC",
          size: "29x32",
          tailored: true,
          seasons: ["Spring", "Summer", "Fall", "Winter"],
        },
        {
          name: "Wide Leg Pants",
          owned: true,
          color: "Washed Blue",
          brand: "Protémoa",
          seasons: ["Spring", "Summer", "Fall", "Winter"],
          size: "31x30",
        },
        {
          name: "Hand Made Canvas Pants",
          owned: true,
          color: "Washed Charcoal Gray",
          brand: "whoisjyra",
          seasons: ["Spring", "Summer", "Fall", "Winter"],
          size: "30x30",
        },
        {
          name: "Straight Leg Jeans",
          owned: true,
          color: "Washed Black",
          brand: "COS",
          size: "30x30",
          seasons: ["Spring", "Summer", "Fall", "Winter"],
        },
        {
          name: "Wide Leg Wool Pants",
          owned: false,
          color: "Gray",
          priority: "High",
          brand: "COS",
          seasons: ["Fall"],
        },
        {
          name: "Relaxed Denim",
          owned: false,
          color: "Gray",
          priority: "Medium",
          brand: "Nanamica",
          seasons: ["Spring", "Summer", "Fall", "Winter"],
        },
        {
          name: "Wide Leg Work Pants",
          owned: false,
          color: "Black",
          priority: "Medium",
          brand: "Stan Ray",
          seasons: ["Spring", "Summer", "Fall", "Winter"],
        },
      ],
      Outerwear: [
        {
          name: "Bone Patching Varsity Jacket",
          owned: true,
          color: "Black",
          brand: "Aelfric Eden",
          size: "M",
          seasons: ["Spring", "Fall", "Winter"],
        },
        {
          name: "Oversized Leather Jacket",
          owned: false,
          color: "Black",
          priority: "High",
          brand: "Vintage",
          seasons: ["Fall"],
        },
        {
          name: "Oversized Wool Shirt Jacket",
          owned: false,
          color: "Brown Check",
          priority: "High",
          brand: "Universal Works",
          seasons: ["Winter"],
        },
        {
          name: "Padded Work Jacket",
          owned: false,
          color: "Black",
          priority: "Medium",
          brand: "Snow Peak",
          seasons: ["Spring"],
        },
        {
          name: "Lightweight Work Jacket",
          owned: false,
          color: "Indigo",
          priority: "High",
          brand: "Blue Blue Japan",
          seasons: ["Spring", "Summer", "Fall", "Winter"],
        },
        {
          name: "Oversized Denim Jacket",
          owned: false,
          color: "Washed Black",
          priority: "Medium",
          brand: "Dickies",
          seasons: ["Spring", "Summer", "Fall", "Winter"],
        },
        {
          name: "Light Chore Coat",
          owned: false,
          color: "Natural",
          priority: "Medium",
          brand: "Le Laboureur",
          seasons: ["Spring"],
        },
      ],
      Footwear: [
        {
          name: "Leather Boots",
          owned: true,
          color: "Black",
          brand: "All Saints",
          seasons: ["Fall", "Winter"],
        },
        {
          name: "Dunk Low Sneakers",
          owned: true,
          color: "Light Gray",
          brand: "Nike",
          seasons: ["Spring", "Summer", "Fall"],
        },
        {
          name: "Chunky Leather Boots",
          owned: false,
          color: "Black",
          priority: "Medium",
          brand: "Dr. Martens",
          seasons: ["Fall"],
        },
        {
          name: "Low-Top Canvas Sneakers",
          owned: false,
          color: "Black",
          priority: "Medium",
          brand: "Moonstar",
          seasons: ["Summer"],
        },
        {
          name: "Chunky Loafers",
          owned: false,
          color: "Black",
          priority: "Low",
          brand: "Paraboot",
          seasons: ["Spring", "Summer", "Fall", "Winter"],
        },
      ],
      Accessories: [
        {
          name: "Urban Sporty Sunglasses",
          owned: true,
          color: "Black",
          brand: "Hawkers",
          seasons: ["Spring", "Summer", "Fall", "Winter"],
        },
        {
          name: "Metal Sunglasses",
          owned: true,
          color: "Black",
          brand: "RayBan",
          seasons: ["Spring", "Summer", "Fall", "Winter"],
        },
        {
          name: "Tech Knit Beanie",
          owned: true,
          color: "Black/Dark Gray",
          brand: "WISDOM",
          seasons: ["Fall", "Winter"],
        },
        {
          name: "Plain Leather Belt",
          owned: true,
          color: "Black",
          brand: "Coach",
          seasons: ["Spring", "Summer", "Fall", "Winter"],
        },
        {
          name: "Curved-Buckle Leather Belt",
          owned: true,
          color: "Black",
          brand: "COS",
          size: "Small",
          seasons: ["Spring", "Summer", "Fall", "Winter"],
        },
        {
          name: "Shiny Leather Belt",
          owned: false,
          color: "Black",
          priority: "Medium",
          brand: "Maison Margiela",
          seasons: ["Spring", "Summer", "Fall", "Winter"],
        },
        {
          name: "Canvas Tote",
          owned: false,
          color: "Natural",
          priority: "Low",
          brand: "Arpenteur",
          seasons: ["Spring", "Summer", "Fall", "Winter"],
        },
        {
          name: "Dad Hat",
          owned: true,
          color: "Washed Blue",
          priority: "Low",
          brand: "buildspace",
          seasons: ["Spring", "Summer", "Fall", "Winter"],
        },
      ],
    },
  };

  const [wardrobe, setWardrobe] = useState<WardrobeData>(initialWardrobe);
  const [activeView, setActiveView] = useState("My Wardrobe");
  const [activeCategory, setActiveCategory] = useState("All");
  const [activeSeason, setActiveSeason] = useState("All");
  const [showAddItemForm, setShowAddItemForm] = useState(false);
  const [newItemName, setNewItemName] = useState("");
  const [newItemCategory, setNewItemCategory] = useState("Tops");
  const [newItemColor, setNewItemColor] = useState("");
  const [newItemBrand, setNewItemBrand] = useState("");
  const [newItemSeasons, setNewItemSeasons] = useState<string[]>([]);
  const [newItemSize, setNewItemSize] = useState("");
  const [newItemIsTailored, setNewItemIsTailored] = useState(false);
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [stylingMode, setStylingMode] = useState(false);
  const [selectedItems, setSelectedItems] = useState<FilteredItem[]>([]);
  const [newItemImageUrl, setNewItemImageUrl] = useState("");

  const handleCloseAddItemForm = () => {
    setNewItemName("");
    setNewItemColor("");
    setNewItemBrand("");
    setNewItemSize("");
    setNewItemSeasons([]);
    setNewItemIsTailored(false);
    setNewItemImageUrl("");
    setNewItemCategory("Tops");
    setShowAddItemForm(false);
  };

  const moveToOwned = (location: string, category: string, index: number) => {
    const updatedWardrobe = { ...wardrobe };
    if (
      updatedWardrobe[location] &&
      updatedWardrobe[location][category] &&
      updatedWardrobe[location][category][index]
    ) {
      updatedWardrobe[location][category][index].owned = true;
      setWardrobe(updatedWardrobe);
      handleCloseAddItemForm();
    }
  };

  const addNewItem = (e: React.FormEvent) => {
    e.preventDefault();

    // Validate required fields
    if (!newItemName.trim()) {
      toast.error("Name is required", {
        description: "Please enter a name for the item",
      });
      return;
    }

    if (!newItemColor.trim()) {
      toast.error("Color is required", {
        description: "Please specify the color of the item",
      });
      return;
    }

    if (!newItemCategory) {
      toast.error("Category is required", {
        description: "Please select a category for the item",
      });
      return;
    }

    if (newItemSeasons.length === 0) {
      toast.error("Seasons are required", {
        description: "Please select at least one season for the item",
      });
      return;
    }

    const updatedWardrobe = { ...wardrobe };
    if (!updatedWardrobe[activeView][newItemCategory]) {
      updatedWardrobe[activeView][newItemCategory] = [];
    }

    updatedWardrobe[activeView][newItemCategory].push({
      name: newItemName,
      owned: activeView === "My Wardrobe",
      color: newItemColor,
      brand: newItemBrand || undefined,
      seasons: newItemSeasons,
      size: newItemSize || undefined,
      tailored: newItemIsTailored,
      imageUrl: newItemImageUrl || undefined,
    });

    setWardrobe(updatedWardrobe);
    handleCloseAddItemForm();

    toast.success("Item added successfully", {
      description: `${newItemName} has been added to your ${activeView}`,
    });
  };

  const removeItem = (location: string, category: string, index: number) => {
    const updatedWardrobe = { ...wardrobe };
    if (updatedWardrobe[location] && updatedWardrobe[location][category]) {
      updatedWardrobe[location][category].splice(index, 1);
      setWardrobe(updatedWardrobe);
    }
  };

  const calculateCompletion = (view: string) => {
    if (view === "Guide") return 0;

    let totalItems = 0;
    let ownedItems = 0;

    if (wardrobe[view]) {
      Object.keys(wardrobe[view]).forEach((category) => {
        if (wardrobe[view][category]) {
          wardrobe[view][category].forEach((item: WardrobeItem) => {
            totalItems++;
            if (item.owned) ownedItems++;
          });
        }
      });
    }

    return totalItems === 0 ? 0 : Math.round((ownedItems / totalItems) * 100);
  };

  interface FilteredItem extends WardrobeItem {
    category: string;
    index: number;
  }

  const getFilteredItems = (): FilteredItem[] => {
    if (activeView === "Guide") {
      return [];
    }

    let filteredItems: FilteredItem[] = [];

    if (activeCategory === "All") {
      filteredItems = Object.entries(wardrobe[activeView] || {}).flatMap(
        ([category, items]) =>
          items.map((item, index) => ({ ...item, category, index }))
      );
    } else if (wardrobe[activeView] && wardrobe[activeView][activeCategory]) {
      filteredItems = (wardrobe[activeView][activeCategory] || []).map(
        (item, index) => ({ ...item, category: activeCategory, index })
      );
    }

    if (activeSeason !== "All") {
      filteredItems = filteredItems.filter((item) =>
        item.seasons?.includes(activeSeason)
      );
    }

    return filteredItems;
  };

  const getOwnedAndWishlistItems = (): {
    owned: FilteredItem[];
    wishlist: FilteredItem[];
  } => {
    const allItems = getFilteredItems();
    return {
      owned: allItems.filter((item) => item.owned),
      wishlist: allItems.filter((item) => !item.owned),
    };
  };

  const getPriorityColor = (
    priority: string
  ): "destructive" | "default" | "outline" | "secondary" => {
    switch (priority) {
      case "High":
        return "destructive";
      case "Medium":
        return "secondary";
      case "Low":
        return "outline";
      default:
        return "secondary";
    }
  };

  const renderSizeInput = () => {
    if (!newItemCategory) return null;

    switch (newItemCategory) {
      case "Tops":
      case "Outerwear":
        return (
          <div>
            <div className="flex items-center h-[14px] gap-2 mb-2">
              <Label htmlFor="size">Size</Label>
              <span className="text-xs text-gray-500">Optional</span>
            </div>
            <Select value={newItemSize} onValueChange={setNewItemSize}>
              <SelectTrigger id="size">
                <SelectValue placeholder="Select size" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="XS">XS</SelectItem>
                <SelectItem value="S">S</SelectItem>
                <SelectItem value="M">M</SelectItem>
                <SelectItem value="L">L</SelectItem>
                <SelectItem value="XL">XL</SelectItem>
                <SelectItem value="XXL">XXL</SelectItem>
              </SelectContent>
            </Select>
          </div>
        );
      case "Bottoms":
        return (
          <div>
            <div className="flex items-center h-[14px] gap-2 mb-2">
              <Label htmlFor="size">Size (Waist x Inseam)</Label>
              <span className="text-xs text-gray-500">Optional</span>
            </div>
            <Input
              id="size"
              value={newItemSize}
              onChange={(e) => setNewItemSize(e.target.value)}
              placeholder="e.g. 30x32 or 32"
            />
          </div>
        );
      case "Footwear":
        return (
          <div>
            <div className="flex items-center h-[14px] gap-2 mb-2">
              <Label htmlFor="size">Shoe Size</Label>
              <span className="text-xs text-gray-500">Optional</span>
            </div>
            <Input
              id="size"
              value={newItemSize}
              onChange={(e) => setNewItemSize(e.target.value)}
              placeholder="e.g. 9.5"
            />
          </div>
        );
      default:
        return (
          <div>
            <div className="flex items-center h-[14px] gap-2 mb-2">
              <Label htmlFor="size">Size</Label>
              <span className="text-xs text-gray-500">Optional</span>
            </div>
            <Input
              id="size"
              value={newItemSize}
              onChange={(e) => setNewItemSize(e.target.value)}
              placeholder="Size"
            />
          </div>
        );
    }
  };

  const toggleItemSelection = (item: FilteredItem) => {
    if (
      selectedItems.some(
        (i) => i.index === item.index && i.category === item.category
      )
    ) {
      setSelectedItems(
        selectedItems.filter(
          (i) => !(i.index === item.index && i.category === item.category)
        )
      );
    } else {
      const existingCategory = selectedItems.findIndex(
        (i) => i.category === item.category
      );
      if (existingCategory >= 0) {
        const newSelection = [...selectedItems];
        newSelection[existingCategory] = item;
        setSelectedItems(newSelection);
      } else {
        setSelectedItems([...selectedItems, item]);
      }
    }
  };

  const getSuggestedItems = (): FilteredItem[] => {
    if (selectedItems.length === 0) return [];

    const ownedItems = Object.entries(wardrobe[activeView] || {}).flatMap(
      ([category, items]) =>
        items
          .filter((item) => item.owned)
          .map((item, index) => ({ ...item, category, index }))
    );

    const selectedCategories = selectedItems.map((item) => item.category);
    const missingCategories = categories.filter(
      (category) => !selectedCategories.includes(category)
    );

    let compatibleSeasons: string[] = [];
    if (selectedItems.length > 0) {
      compatibleSeasons = selectedItems[0].seasons || [];
      for (const item of selectedItems) {
        compatibleSeasons = compatibleSeasons.filter((season) =>
          item.seasons?.includes(season)
        );
      }
      if (compatibleSeasons.length === 0 && selectedItems[0].seasons) {
        compatibleSeasons = selectedItems[0].seasons;
      }
    }

    const filteredItems = ownedItems.filter(
      (item) =>
        !selectedItems.some(
          (i) => i.index === item.index && i.category === item.category
        )
    );

    let suggestedItems = filteredItems.filter(
      (item) =>
        missingCategories.includes(item.category) &&
        item.seasons?.some((season) => compatibleSeasons.includes(season))
    );

    if (suggestedItems.length === 0) {
      suggestedItems = filteredItems.filter((item) =>
        missingCategories.includes(item.category)
      );
    }

    if (suggestedItems.length === 0) {
      suggestedItems = filteredItems;
    }

    const selectedColors = selectedItems.map((item) =>
      item.color.toLowerCase()
    );
    const complementaryColors = getComplementaryColors(selectedColors);

    return suggestedItems
      .map((item) => ({
        ...item,
        score:
          (complementaryColors.includes(item.color.toLowerCase()) ? 2 : 0) +
          (item.seasons?.filter((s) => compatibleSeasons.includes(s))?.length /
            Math.max(compatibleSeasons.length, 1) || 0),
      }))
      .sort((a, b) => (b.score || 0) - (a.score || 0))
      .slice(0, 4);
  };

  const getComplementaryColors = (colors: string[]): string[] => {
    const neutrals = ["black", "white", "gray", "cream", "navy", "natural"];

    if (colors.some((c) => neutrals.includes(c) || c.includes("gray"))) {
      return [...neutrals, "olive", "camel", "taupe", "washed blue", "brown"];
    }

    if (colors.includes("black")) {
      return ["white", "cream", "gray", "washed blue", "earth tone"];
    }

    if (
      colors.some(
        (c) =>
          c.includes("brown") ||
          c.includes("olive") ||
          c.includes("earth") ||
          c.includes("natural")
      )
    ) {
      return ["black", "white", "gray", "cream", "navy"];
    }

    return neutrals;
  };

  const clearSelection = () => {
    setSelectedItems([]);
  };

  const suggestCompleteOutfit = () => {
    let newSelection: FilteredItem[] = [];

    if (selectedItems.length > 0) {
      newSelection = [...selectedItems];
    } else {
      const ownedTops = wardrobe[activeView]?.Tops
        ? wardrobe[activeView].Tops.filter((item) => item.owned).map(
            (item, index) => ({ ...item, category: "Tops" as const, index })
          )
        : [];

      if (ownedTops.length > 0) {
        newSelection = [
          ownedTops[Math.floor(Math.random() * ownedTops.length)],
        ];
      }
    }

    if (newSelection.length > 0) {
      setSelectedItems(newSelection);
    }
  };

  const handleImageUploaded = (url: string) => {
    setNewItemImageUrl(url);
  };

  return (
    <div className="w-full p-4 md:p-8 bg-gray-50 min-h-screen">
      <div className="w-full mx-auto">
        <header className="mb-8 border-b border-gray-200 pb-4">
          <h1 className="text-4xl font-bold mb-2 text-gray-800 uppercase tracking-wide">
            CAPSULE // Your Digital Wardrobe Curator
          </h1>
          <div className="flex justify-between items-center">
            <p className="text-gray-600 font-light">
              Track and organize your personal wardrobe collection
            </p>
            <a
              href="https://www.pinterest.com/linsh586/style/"
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs uppercase tracking-wide text-gray-500 hover:text-gray-900 border border-gray-200 px-3 py-1 rounded-none"
            >
              Mood Board
            </a>
          </div>
        </header>

        <Tabs value={activeView} onValueChange={setActiveView} className="mb-6">
          <div className="flex justify-between items-center mb-6">
            <TabsList className="border-b rounded-none bg-transparent p-0 h-auto">
              {wardrobeViews.map((view) => (
                <TabsTrigger
                  key={view}
                  value={view}
                  onClick={() => {
                    setActiveSeason("All");
                  }}
                  className="px-6 py-2 rounded-none border-0 data-[state=active]:border-b-2 data-[state=active]:border-primary data-[state=active]:shadow-none data-[state=active]:bg-transparent bg-transparent hover:bg-transparent text-foreground/70 data-[state=active]:text-foreground font-medium uppercase tracking-wide"
                >
                  {view} {view !== "Guide" && `(${calculateCompletion(view)}%)`}
                </TabsTrigger>
              ))}
            </TabsList>

            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setStylingMode(!stylingMode);
                  if (!stylingMode) {
                    setSelectedItems([]);
                  }
                }}
                className={cn(
                  stylingMode && "bg-black text-white hover:bg-gray-800"
                )}
              >
                {stylingMode ? "Exit Styling" : "Outfit Builder"}
              </Button>
              <Button
                variant={viewMode === "grid" ? "default" : "outline"}
                size="sm"
                onClick={() => setViewMode("grid")}
              >
                Grid
              </Button>
              <Button
                variant={viewMode === "list" ? "default" : "outline"}
                size="sm"
                onClick={() => setViewMode("list")}
              >
                List
              </Button>
            </div>
          </div>

          {wardrobeViews.map((view) => (
            <TabsContent
              key={view}
              value={view}
              className="pt-4 animate-in fade-in-50"
            >
              {view === "Guide" ? (
                <Card className="mb-8 rounded-none border shadow-none">
                  <CardContent className="p-6">
                    <h2 className="text-2xl font-bold mb-4 text-gray-800 uppercase tracking-tight">
                      Japanese Streetwear Guide
                    </h2>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-6">
                      <div>
                        <h3 className="text-lg font-medium text-gray-800 mb-3 border-b pb-2">
                          Layering Strategy
                        </h3>
                        <div className="mb-4">
                          <p className="text-sm font-medium text-gray-700">
                            For cooler days (Boston Spring or SF fog):
                          </p>
                          <ul className="text-sm text-gray-600 list-disc ml-6 mb-3 space-y-1 mt-2">
                            <li>Base layer: Tank top or t-shirt</li>
                            <li>
                              Mid layer: Oversized button-up or long-sleeve tee
                            </li>
                            <li>
                              Outer layer: Leather jacket, wool shirt jacket, or
                              work jacket
                            </li>
                          </ul>
                        </div>
                        <div>
                          <p className="text-sm font-medium text-gray-700">
                            For warmer days:
                          </p>
                          <ul className="text-sm text-gray-600 list-disc ml-6 space-y-1 mt-2">
                            <li>
                              Single layer: Oversized tee or loose linen shirt
                            </li>
                            <li>Light layer: Tank top with thin overshirt</li>
                          </ul>
                        </div>
                      </div>

                      <div>
                        <h3 className="text-lg font-medium text-gray-800 mb-3 border-b pb-2">
                          Essential Purchases
                        </h3>
                        <ol className="text-sm text-gray-600 list-decimal ml-6 space-y-2">
                          <li>
                            <span className="font-medium">
                              Baggy jeans - washed black
                            </span>{" "}
                            {`(Levi's Silver Tab)`}
                          </li>
                          <li>
                            <span className="font-medium">
                              Oversized long-sleeve tees
                            </span>{" "}
                            (UNIQLO U)
                          </li>
                          <li>
                            <span className="font-medium">
                              Leather jacket or work jacket
                            </span>{" "}
                            (Vintage or Blue Blue Japan)
                          </li>
                          <li>
                            <span className="font-medium">Wide leg pants</span>{" "}
                            in a different color (OrSlow)
                          </li>
                          <li>
                            <span className="font-medium">Layering pieces</span>{" "}
                            (button-ups, light jackets)
                          </li>
                        </ol>
                      </div>
                    </div>

                    <div>
                      <h3 className="text-lg font-medium text-gray-800 mb-3 border-b pb-2">
                        Brand Recommendations
                      </h3>
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                        <div className="bg-gray-50 p-3 rounded">
                          <p className="text-sm font-medium text-gray-700 mb-2">
                            Investment Pieces:
                          </p>
                          <ul className="text-sm text-gray-600 list-disc ml-4 space-y-1">
                            <li>Kapital</li>
                            <li>Needles</li>
                            <li>Engineered Garments</li>
                            <li>Evan Kinori</li>
                            <li>Blue Blue Japan</li>
                          </ul>
                        </div>
                        <div className="bg-gray-50 p-3 rounded">
                          <p className="text-sm font-medium text-gray-700 mb-2">
                            Mid-range Options:
                          </p>
                          <ul className="text-sm text-gray-600 list-disc ml-4 space-y-1">
                            <li>OrSlow</li>
                            <li>Universal Works</li>
                            <li>Carhartt WIP</li>
                            <li>Story MFG</li>
                            <li>Beams Plus</li>
                          </ul>
                        </div>
                        <div className="bg-gray-50 p-3 rounded">
                          <p className="text-sm font-medium text-gray-700 mb-2">
                            Accessible Options:
                          </p>
                          <ul className="text-sm text-gray-600 list-disc ml-4 space-y-1">
                            <li>UNIQLO U</li>
                            <li>Dickies (sized up)</li>
                            <li>Vintage/secondhand</li>
                            <li>COS</li>
                            <li>Stan Ray</li>
                          </ul>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ) : (
                <>
                  <div className="bg-white p-4 rounded-none border shadow-none mb-6">
                    <div className="flex flex-col items-center gap-4">
                      <div className="flex-1">
                        <h3 className="text-sm font-medium text-gray-700 mb-2">
                          Filter by Category:
                        </h3>
                        <div className="flex flex-wrap gap-2">
                          <Button
                            variant={
                              activeCategory === "All" ? "default" : "outline"
                            }
                            size="sm"
                            onClick={() => setActiveCategory("All")}
                          >
                            All
                          </Button>
                          {categories.map((category) => (
                            <Button
                              key={category}
                              variant={
                                activeCategory === category
                                  ? "default"
                                  : "outline"
                              }
                              size="sm"
                              onClick={() => setActiveCategory(category)}
                            >
                              <span className="text-lg mr-1">
                                {categoryIcons[category]}
                              </span>{" "}
                              {category}
                            </Button>
                          ))}
                        </div>
                      </div>

                      <div className="flex-1">
                        <h3 className="text-sm font-medium text-gray-700 mb-2">
                          Filter by Season:
                        </h3>
                        <div className="flex flex-wrap gap-2">
                          <Button
                            variant={
                              activeSeason === "All" ? "default" : "outline"
                            }
                            size="sm"
                            onClick={() => setActiveSeason("All")}
                            className="text-xs"
                          >
                            All Seasons
                          </Button>
                          <Button
                            variant={
                              activeSeason === "Spring" ? "default" : "outline"
                            }
                            size="sm"
                            onClick={() => setActiveSeason("Spring")}
                            className="text-xs"
                          >
                            Spring
                          </Button>
                          <Button
                            variant={
                              activeSeason === "Summer" ? "default" : "outline"
                            }
                            size="sm"
                            onClick={() => setActiveSeason("Summer")}
                            className="text-xs"
                          >
                            Summer
                          </Button>
                          <Button
                            variant={
                              activeSeason === "Fall" ? "default" : "outline"
                            }
                            size="sm"
                            onClick={() => setActiveSeason("Fall")}
                            className="text-xs"
                          >
                            Fall
                          </Button>
                          <Button
                            variant={
                              activeSeason === "Winter" ? "default" : "outline"
                            }
                            size="sm"
                            onClick={() => setActiveSeason("Winter")}
                            className="text-xs"
                          >
                            Winter
                          </Button>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="mb-8 flex justify-between items-center">
                    <h2 className="text-xl font-semibold text-gray-800">
                      {view} Items
                    </h2>
                    <Button
                      onClick={() => {
                        if (showAddItemForm) {
                          handleCloseAddItemForm();
                        } else {
                          setShowAddItemForm(true);
                        }
                      }}
                      size="sm"
                    >
                      {showAddItemForm ? "Cancel" : "Add New Item"}
                    </Button>
                  </div>

                  {showAddItemForm && (
                    <Card className="mb-8 border-2 border-dashed border-primary/50 rounded-none py-8">
                      <CardHeader className="border-b">
                        <CardTitle className="uppercase tracking-tight">
                          Add New Item
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="p-6 py-0">
                        <form onSubmit={addNewItem} className="space-y-4">
                          <div className="mb-6">
                            <Label>Item Image</Label>
                            <div className="mt-2 w-64 h-64 border-2 border-dashed border-gray-200 rounded-none">
                              {newItemImageUrl ? (
                                <div className="relative w-full h-full flex items-center justify-center">
                                  <img
                                    src={newItemImageUrl}
                                    alt="Item preview"
                                    className="w-full h-full object-cover"
                                  />
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    className="absolute top-2 right-2"
                                    onClick={() => setNewItemImageUrl("")}
                                  >
                                    <XCircle className="h-4 w-4" />
                                  </Button>
                                </div>
                              ) : (
                                <div className="w-full h-full flex items-center justify-center">
                                  <ImageUpload
                                    onUploadComplete={handleImageUploaded}
                                  />
                                </div>
                              )}
                            </div>
                          </div>
                          <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                              <Label htmlFor="name">Name</Label>
                              <Input
                                id="name"
                                value={newItemName}
                                onChange={(e) => setNewItemName(e.target.value)}
                              />
                            </div>
                            <div className="space-y-2">
                              <Label htmlFor="category">Category</Label>
                              <Select
                                value={newItemCategory}
                                onValueChange={(value) => {
                                  setNewItemCategory(value);
                                  setNewItemSize("");
                                }}
                              >
                                <SelectTrigger className="rounded-none">
                                  <SelectValue placeholder="Select category" />
                                </SelectTrigger>
                                <SelectContent>
                                  {categories.map((category) => (
                                    <SelectItem key={category} value={category}>
                                      <span className="text-lg mr-1">
                                        {categoryIcons[category]}
                                      </span>{" "}
                                      {category}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                            <div className="space-y-2">
                              <Label htmlFor="brand">Brand</Label>
                              <Input
                                id="brand"
                                value={newItemBrand}
                                onChange={(e) =>
                                  setNewItemBrand(e.target.value)
                                }
                                placeholder="Brand name"
                              />
                            </div>
                            <div className="space-y-2">
                              <Label htmlFor="color">Color</Label>
                              <Input
                                id="color"
                                value={newItemColor}
                                onChange={(e) =>
                                  setNewItemColor(e.target.value)
                                }
                                placeholder="e.g. Black, Navy, Washed Blue"
                              />
                            </div>
                            <div className="space-y-2">
                              <Label htmlFor="seasons">
                                Seasons (select multiple)
                              </Label>
                              <div className="flex flex-wrap gap-2">
                                <Button
                                  type="button"
                                  size="sm"
                                  variant={
                                    newItemSeasons.includes("Spring")
                                      ? "default"
                                      : "outline"
                                  }
                                  className="text-xs min-w-[70px] border"
                                  onClick={() => {
                                    if (newItemSeasons.includes("Spring")) {
                                      setNewItemSeasons(
                                        newItemSeasons.filter(
                                          (s) => s !== "Spring"
                                        )
                                      );
                                    } else {
                                      setNewItemSeasons([
                                        ...newItemSeasons,
                                        "Spring",
                                      ]);
                                    }
                                  }}
                                >
                                  Spring
                                </Button>
                                <Button
                                  type="button"
                                  size="sm"
                                  variant={
                                    newItemSeasons.includes("Summer")
                                      ? "default"
                                      : "outline"
                                  }
                                  className="text-xs min-w-[70px] border"
                                  onClick={() => {
                                    if (newItemSeasons.includes("Summer")) {
                                      setNewItemSeasons(
                                        newItemSeasons.filter(
                                          (s) => s !== "Summer"
                                        )
                                      );
                                    } else {
                                      setNewItemSeasons([
                                        ...newItemSeasons,
                                        "Summer",
                                      ]);
                                    }
                                  }}
                                >
                                  Summer
                                </Button>
                                <Button
                                  type="button"
                                  size="sm"
                                  variant={
                                    newItemSeasons.includes("Fall")
                                      ? "default"
                                      : "outline"
                                  }
                                  className="text-xs min-w-[70px] border"
                                  onClick={() => {
                                    if (newItemSeasons.includes("Fall")) {
                                      setNewItemSeasons(
                                        newItemSeasons.filter(
                                          (s) => s !== "Fall"
                                        )
                                      );
                                    } else {
                                      setNewItemSeasons([
                                        ...newItemSeasons,
                                        "Fall",
                                      ]);
                                    }
                                  }}
                                >
                                  Fall
                                </Button>
                                <Button
                                  type="button"
                                  size="sm"
                                  variant={
                                    newItemSeasons.includes("Winter")
                                      ? "default"
                                      : "outline"
                                  }
                                  className="text-xs min-w-[70px] border"
                                  onClick={() => {
                                    if (newItemSeasons.includes("Winter")) {
                                      setNewItemSeasons(
                                        newItemSeasons.filter(
                                          (s) => s !== "Winter"
                                        )
                                      );
                                    } else {
                                      setNewItemSeasons([
                                        ...newItemSeasons,
                                        "Winter",
                                      ]);
                                    }
                                  }}
                                >
                                  Winter
                                </Button>
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  className="text-xs min-w-[70px] border"
                                  onClick={() => {
                                    if (newItemSeasons.length === 4) {
                                      setNewItemSeasons([]);
                                    } else {
                                      setNewItemSeasons([
                                        "Spring",
                                        "Summer",
                                        "Fall",
                                        "Winter",
                                      ]);
                                    }
                                  }}
                                >
                                  {newItemSeasons.length === 4
                                    ? "Clear All"
                                    : "Select All"}
                                </Button>
                              </div>
                            </div>
                            {renderSizeInput()}
                            <div className="flex items-center space-x-2">
                              <Checkbox
                                id="tailored"
                                checked={newItemIsTailored}
                                onCheckedChange={(checked) =>
                                  setNewItemIsTailored(checked === true)
                                }
                              />
                              <Label htmlFor="tailored" className="text-sm">
                                Item has been tailored
                              </Label>
                            </div>
                          </div>
                          <Button type="submit" className="mt-4">
                            Add Item
                          </Button>
                        </form>
                      </CardContent>
                    </Card>
                  )}

                  <div className="space-y-8">
                    <div className="mb-8 w-full">
                      <h2 className="text-xl font-semibold text-gray-800 mb-4">
                        Owned Items
                      </h2>
                      {getOwnedAndWishlistItems().owned.length > 0 ? (
                        viewMode === "grid" ? (
                          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6 w-full">
                            {getOwnedAndWishlistItems().owned.map((item, i) => (
                              <div
                                key={`owned-${item.category}-${item.index}-${i}`}
                                className="flex flex-col"
                              >
                                <Card className="w-full overflow-hidden border border-gray-200 group relative h-[200px] flex items-center justify-center bg-white rounded-none">
                                  {stylingMode && (
                                    <div
                                      className="absolute inset-0 z-20 cursor-pointer"
                                      onClick={() => toggleItemSelection(item)}
                                    />
                                  )}
                                  {stylingMode &&
                                    selectedItems.some(
                                      (i) =>
                                        i.index === item.index &&
                                        i.category === item.category
                                    ) && (
                                      <div className="absolute inset-0 bg-black bg-opacity-10 z-10 flex items-center justify-center">
                                        <div className="bg-white px-3 py-1 text-xs uppercase tracking-wide">
                                          Selected
                                        </div>
                                      </div>
                                    )}
                                  <div className="absolute right-2 top-2 opacity-0 group-hover:opacity-100 transition-opacity flex gap-1">
                                    {item.size && (
                                      <Badge
                                        variant="outline"
                                        className={cn(
                                          "rounded-none",
                                          "bg-white backdrop-blur-sm text-xs"
                                        )}
                                      >
                                        {item.size}
                                        {item.tailored && (
                                          <span className="ml-1 text-amber-600 flex items-center">
                                            <Scissors className="h-3 w-3 ml-1" />
                                          </span>
                                        )}
                                      </Badge>
                                    )}
                                    {item.seasons &&
                                      item.seasons.length > 0 && (
                                        <Badge
                                          variant="secondary"
                                          className={cn(
                                            "text-xs",
                                            "bg-white backdrop-blur-sm rounded-none"
                                          )}
                                        >
                                          {item.seasons.length === 4
                                            ? "All Seasons"
                                            : item.seasons.join(", ")}
                                        </Badge>
                                      )}
                                  </div>

                                  <div className="text-center z-10 px-3 flex items-center justify-center">
                                    <span className="text-2xl text-gray-300">
                                      {categoryIcons[item.category]}
                                    </span>
                                  </div>

                                  <div className="absolute bottom-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                    <AlertDialog>
                                      <AlertDialogTrigger asChild>
                                        <Button
                                          variant="outline"
                                          size="sm"
                                          className={cn(
                                            "bg-white backdrop-blur-sm rounded-none"
                                          )}
                                        >
                                          <Trash2 className="h-4 w-4" />
                                        </Button>
                                      </AlertDialogTrigger>
                                      <AlertDialogContent className="rounded-none">
                                        <AlertDialogHeader>
                                          <AlertDialogTitle>
                                            Remove Item
                                          </AlertDialogTitle>
                                          <AlertDialogDescription>
                                            Are you sure you want to remove{" "}
                                            <span className="font-semibold">
                                              {item.name}
                                            </span>{" "}
                                            from your owned items?
                                          </AlertDialogDescription>
                                        </AlertDialogHeader>
                                        <AlertDialogFooter>
                                          <AlertDialogCancel>
                                            Cancel
                                          </AlertDialogCancel>
                                          <AlertDialogAction
                                            onClick={() =>
                                              removeItem(
                                                view,
                                                item.category,
                                                item.index
                                              )
                                            }
                                            className="bg-red-500 hover:bg-red-600"
                                          >
                                            Remove
                                          </AlertDialogAction>
                                        </AlertDialogFooter>
                                      </AlertDialogContent>
                                    </AlertDialog>
                                  </div>

                                  {item.priority && (
                                    <div className="absolute bottom-2 left-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                      <Badge
                                        variant={getPriorityColor(
                                          item.priority
                                        )}
                                        className={cn("rounded-none")}
                                      >
                                        {item.priority}
                                      </Badge>
                                    </div>
                                  )}
                                </Card>
                                <div className="mt-2">
                                  <p className="font-medium text-gray-800">
                                    {item.name}
                                  </p>
                                  {item.brand && (
                                    <p className="text-sm text-gray-600">
                                      {item.brand}
                                    </p>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="w-full space-y-2">
                            {getOwnedAndWishlistItems().owned.map((item, i) => (
                              <Card
                                key={`owned-list-${item.category}-${item.index}-${i}`}
                                className={cn(
                                  "w-full overflow-hidden border border-gray-200 group relative bg-white",
                                  stylingMode &&
                                    selectedItems.some(
                                      (i) =>
                                        i.index === item.index &&
                                        i.category === item.category
                                    ) &&
                                    "bg-gray-50"
                                )}
                              >
                                {stylingMode && (
                                  <div
                                    className="absolute inset-0 z-20 cursor-pointer"
                                    onClick={() => toggleItemSelection(item)}
                                  />
                                )}
                                <CardContent className="p-4 flex items-center">
                                  <div className="flex-1">
                                    <p className="text-gray-800 font-medium">
                                      {item.name}
                                    </p>
                                    {item.brand && (
                                      <p className="text-sm text-gray-600">
                                        {item.brand}
                                      </p>
                                    )}
                                  </div>

                                  <div
                                    className={cn(
                                      "flex items-center gap-2",
                                      "opacity-0 group-hover:opacity-100 transition-opacity"
                                    )}
                                  >
                                    {item.size && (
                                      <Badge
                                        variant="outline"
                                        className={cn(
                                          "text-xs",
                                          "bg-white backdrop-blur-sm"
                                        )}
                                      >
                                        {item.size}
                                        {item.tailored && (
                                          <span className="ml-1 text-amber-600 flex items-center">
                                            <Scissors className="h-3 w-3 ml-1" />
                                          </span>
                                        )}
                                      </Badge>
                                    )}
                                    {item.seasons &&
                                      item.seasons.length > 0 && (
                                        <Badge
                                          variant="secondary"
                                          className={cn(
                                            "text-xs",
                                            "bg-white backdrop-blur-sm rounded-none"
                                          )}
                                        >
                                          {item.seasons.length === 4
                                            ? "All Seasons"
                                            : item.seasons.join(", ")}
                                        </Badge>
                                      )}
                                    {item.priority && (
                                      <Badge
                                        variant={getPriorityColor(
                                          item.priority
                                        )}
                                        className={cn("rounded-none")}
                                      >
                                        {item.priority}
                                      </Badge>
                                    )}
                                    <AlertDialog>
                                      <AlertDialogTrigger asChild>
                                        <Button variant="outline" size="sm">
                                          <Trash2 className="h-4 w-4" />
                                        </Button>
                                      </AlertDialogTrigger>
                                      <AlertDialogContent className="rounded-none">
                                        <AlertDialogHeader>
                                          <AlertDialogTitle>
                                            Remove Item
                                          </AlertDialogTitle>
                                          <AlertDialogDescription>
                                            Are you sure you want to remove{" "}
                                            <span className="font-semibold">
                                              {item.name}
                                            </span>{" "}
                                            from your owned items?
                                          </AlertDialogDescription>
                                        </AlertDialogHeader>
                                        <AlertDialogFooter>
                                          <AlertDialogCancel>
                                            Cancel
                                          </AlertDialogCancel>
                                          <AlertDialogAction
                                            onClick={() =>
                                              removeItem(
                                                view,
                                                item.category,
                                                item.index
                                              )
                                            }
                                            className="bg-red-500 hover:bg-red-600"
                                          >
                                            Remove
                                          </AlertDialogAction>
                                        </AlertDialogFooter>
                                      </AlertDialogContent>
                                    </AlertDialog>
                                  </div>
                                </CardContent>
                              </Card>
                            ))}
                          </div>
                        )
                      ) : (
                        <div className="p-8 text-center bg-white rounded-none border border-dashed text-gray-500 w-full">
                          No owned items in this category.
                        </div>
                      )}
                    </div>

                    <Separator className="my-8" />

                    <div className="mb-8 w-full">
                      <h2 className="text-xl font-semibold text-gray-800 mb-4">
                        Wishlist Items
                      </h2>
                      {getOwnedAndWishlistItems().wishlist.length > 0 ? (
                        viewMode === "grid" ? (
                          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6 w-full">
                            {getOwnedAndWishlistItems().wishlist.map(
                              (item, i) => (
                                <div
                                  key={`wishlist-${item.category}-${item.index}-${i}`}
                                  className="flex flex-col"
                                >
                                  <Card className="w-full overflow-hidden border border-gray-200 group relative h-[200px] flex items-center justify-center bg-white rounded-none">
                                    {stylingMode && (
                                      <div
                                        className="absolute inset-0 z-20 cursor-pointer"
                                        onClick={() =>
                                          toggleItemSelection(item)
                                        }
                                      />
                                    )}
                                    {stylingMode &&
                                      selectedItems.some(
                                        (i) =>
                                          i.index === item.index &&
                                          i.category === item.category
                                      ) && (
                                        <div className="absolute inset-0 bg-black bg-opacity-10 z-10 flex items-center justify-center">
                                          <div className="bg-white px-3 py-1 text-xs uppercase tracking-wide">
                                            Selected
                                          </div>
                                        </div>
                                      )}
                                    <div className="absolute right-2 top-2 opacity-0 group-hover:opacity-100 transition-opacity flex gap-1">
                                      {item.size && (
                                        <Badge
                                          variant="outline"
                                          className={cn(
                                            "rounded-none bg-white backdrop-blur-sm text-xs"
                                          )}
                                        >
                                          {item.size}
                                          {item.tailored && (
                                            <span className="ml-1 text-amber-600 flex items-center">
                                              <Scissors className="h-3 w-3 ml-1" />
                                            </span>
                                          )}
                                        </Badge>
                                      )}
                                      {item.seasons &&
                                        item.seasons.length > 0 && (
                                          <Badge
                                            variant="secondary"
                                            className={cn(
                                              "text-xs",
                                              "bg-white backdrop-blur-sm rounded-none"
                                            )}
                                          >
                                            {item.seasons.length === 4
                                              ? "All Seasons"
                                              : item.seasons.join(", ")}
                                          </Badge>
                                        )}
                                    </div>

                                    <div className="text-center z-10 px-3 flex items-center justify-center">
                                      <span className="text-2xl text-gray-300">
                                        {categoryIcons[item.category]}
                                      </span>
                                    </div>

                                    <div className="absolute bottom-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                      <Button
                                        variant="outline"
                                        size="sm"
                                        className={cn(
                                          "bg-white backdrop-blur-sm rounded-none"
                                        )}
                                        onClick={() =>
                                          moveToOwned(
                                            view,
                                            item.category,
                                            item.index
                                          )
                                        }
                                      >
                                        <Import className="h-4 w-4" />
                                      </Button>
                                    </div>

                                    {item.priority && (
                                      <div className="absolute bottom-2 left-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                        <Badge
                                          variant={getPriorityColor(
                                            item.priority
                                          )}
                                          className={cn("rounded-none")}
                                        >
                                          {item.priority}
                                        </Badge>
                                      </div>
                                    )}
                                  </Card>
                                  <div className="mt-2">
                                    <p className="font-medium text-gray-800">
                                      {item.name}
                                    </p>
                                    {item.brand && (
                                      <p className="text-sm text-gray-600">
                                        {item.brand}
                                      </p>
                                    )}
                                  </div>
                                </div>
                              )
                            )}
                          </div>
                        ) : (
                          <div className="w-full space-y-2">
                            {getOwnedAndWishlistItems().wishlist.map(
                              (item, i) => (
                                <Card
                                  key={`wishlist-list-${item.category}-${item.index}-${i}`}
                                  className={cn(
                                    "w-full overflow-hidden border border-gray-200 group relative bg-white",
                                    stylingMode &&
                                      selectedItems.some(
                                        (i) =>
                                          i.index === item.index &&
                                          i.category === item.category
                                      ) &&
                                      "bg-gray-50"
                                  )}
                                >
                                  {stylingMode && (
                                    <div
                                      className="absolute inset-0 z-20 cursor-pointer"
                                      onClick={() => toggleItemSelection(item)}
                                    />
                                  )}
                                  <CardContent className="p-4 flex items-center">
                                    <div className="flex-1">
                                      <p className="text-gray-800 font-medium">
                                        {item.name}
                                      </p>
                                      {item.brand && (
                                        <p className="text-sm text-gray-600">
                                          {item.brand}
                                        </p>
                                      )}
                                    </div>

                                    <div
                                      className={cn(
                                        "flex items-center gap-2",
                                        "opacity-0 group-hover:opacity-100 transition-opacity"
                                      )}
                                    >
                                      {item.size && (
                                        <Badge
                                          variant="outline"
                                          className={cn(
                                            "text-xs",
                                            "bg-white backdrop-blur-sm"
                                          )}
                                        >
                                          {item.size}
                                          {item.tailored && (
                                            <span className="ml-1 text-amber-600 flex items-center">
                                              <Scissors className="h-3 w-3 ml-1" />
                                            </span>
                                          )}
                                        </Badge>
                                      )}
                                      {item.seasons &&
                                        item.seasons.length > 0 && (
                                          <Badge
                                            variant="secondary"
                                            className={cn(
                                              "text-xs",
                                              "bg-white backdrop-blur-sm rounded-none"
                                            )}
                                          >
                                            {item.seasons.length === 4
                                              ? "All Seasons"
                                              : item.seasons.join(", ")}
                                          </Badge>
                                        )}
                                      {item.priority && (
                                        <Badge
                                          variant={getPriorityColor(
                                            item.priority
                                          )}
                                          className={cn("rounded-none")}
                                        >
                                          {item.priority}
                                        </Badge>
                                      )}
                                      <Button
                                        variant="outline"
                                        size="sm"
                                        className={cn(
                                          "bg-white backdrop-blur-sm rounded-none"
                                        )}
                                        onClick={() =>
                                          moveToOwned(
                                            view,
                                            item.category,
                                            item.index
                                          )
                                        }
                                      >
                                        <Import className="h-4 w-4" />
                                      </Button>
                                    </div>
                                  </CardContent>
                                </Card>
                              )
                            )}
                          </div>
                        )
                      ) : (
                        <div className="p-8 text-center bg-white rounded-none border border-dashed text-gray-500 w-full">
                          No wishlist items in this category.
                        </div>
                      )}
                    </div>
                  </div>
                </>
              )}
            </TabsContent>
          ))}
        </Tabs>

        {stylingMode && (
          <div className="mb-8 bg-white border rounded-none p-4">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-lg font-medium uppercase tracking-tight">
                Outfit Builder
              </h2>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={clearSelection}
                  className="text-xs"
                >
                  Clear All
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={suggestCompleteOutfit}
                  className="text-xs flex items-center gap-1"
                >
                  <RefreshCw className="h-3 w-3" /> Suggest
                </Button>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <h3 className="text-sm uppercase tracking-wide mb-3 text-gray-500">
                  Selected Items
                </h3>
                {selectedItems.length === 0 ? (
                  <div className="border border-dashed p-8 text-center text-gray-400 text-sm">
                    Select items from your wardrobe to build an outfit
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-3">
                    {selectedItems.map((item, i) => (
                      <div
                        key={`selected-${i}`}
                        className="relative border bg-gray-50 p-2"
                      >
                        <button
                          onClick={() => toggleItemSelection(item)}
                          className="absolute -top-2 -right-2 text-gray-400 hover:text-gray-700 z-10"
                        >
                          <XCircle className="h-5 w-5" />
                        </button>
                        <div className="text-center">
                          <span className="text-xl text-gray-300">
                            {categoryIcons[item.category]}
                          </span>
                        </div>
                        <div className="mt-2 text-xs text-center">
                          <p className="font-medium">{item.name}</p>
                          <p className="text-gray-500">{item.color}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <h3 className="text-sm uppercase tracking-wide mb-3 text-gray-500">
                  Suggested Pairings
                </h3>
                {selectedItems.length === 0 ? (
                  <div className="border border-dashed p-8 text-center text-gray-400 text-sm">
                    Select at least one item to see suggestions
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-3">
                    {getSuggestedItems().length > 0 ? (
                      getSuggestedItems().map((item, i) => (
                        <div
                          key={`suggestion-${i}`}
                          className="border p-2 hover:bg-gray-50 cursor-pointer"
                          onClick={() => toggleItemSelection(item)}
                        >
                          <div className="text-center">
                            <span className="text-xl text-gray-300">
                              {categoryIcons[item.category]}
                            </span>
                          </div>
                          <div className="mt-2 text-xs text-center">
                            <p className="font-medium">{item.name}</p>
                            <p className="text-gray-500">{item.color}</p>
                          </div>
                        </div>
                      ))
                    ) : (
                      <div className="col-span-2 border p-4 text-center text-gray-400">
                        No matching items found. Try selecting a different item
                        or add more items to your wardrobe.
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
