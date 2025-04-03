import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
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

// Define types for the wardrobe items
interface WardrobeItem {
  name: string;
  owned: boolean;
  priority?: string;
  brand?: string;
  season?: string;
}

interface CategoryItems {
  [category: string]: WardrobeItem[];
}

interface WardrobeData {
  [location: string]: CategoryItems;
}

const WardrobeBuilder = () => {
  // Categories for wardrobe items
  const categories = [
    "Tops",
    "Bottoms",
    "Outerwear",
    "Footwear",
    "Accessories",
  ];

  // Wardrobe views
  const wardrobeViews = ["Guide", "Current", "Year-Round Collection"];

  // Initial wardrobe items
  const initialWardrobe: WardrobeData = {
    Guide: {},
    Current: {
      Tops: [
        { name: "Black Tank Top", owned: true },
        { name: "Gray Tank Top", owned: true },
        { name: "White Tank Top", owned: true },
        { name: "White Oversized Dress Shirt w/ Japanese Art", owned: true },
        { name: "Black Sweatshirt w/ Destructive Patches", owned: true },
        { name: "Dark Gray Sweater w/ Destructive Holes", owned: true },
      ],
      Bottoms: [
        { name: "Wisdom Nylon Wide Opening Pants", owned: true },
        { name: "Black Wide-Leg Pants w/ Zipper & Buttons", owned: true },
      ],
      Outerwear: [],
      Footwear: [
        { name: "All Saints Boots", owned: true },
        { name: "Light Gray Nike Dunk Low", owned: true },
      ],
      Accessories: [],
    },
    "Year-Round Collection": {
      Tops: [
        {
          name: "Oversized Long-Sleeve Tee - Black",
          owned: false,
          priority: "High",
          brand: "UNIQLO U",
          season: "All Seasons",
        },
        {
          name: "Oversized Long-Sleeve Tee - Earth Tone",
          owned: false,
          priority: "High",
          brand: "Needles",
          season: "All Seasons",
        },
        {
          name: "Striped Oversized Sweater - Gray/Black",
          owned: false,
          priority: "Medium",
          brand: "Kapital",
          season: "Cool Weather",
        },
        {
          name: "Loose Fit Button-Up - Cream",
          owned: false,
          priority: "Medium",
          brand: "Evan Kinori",
          season: "All Seasons",
        },
        {
          name: "Loose Fit Button-Up - Washed Black",
          owned: false,
          priority: "Medium",
          brand: "Engineered Garments",
          season: "All Seasons",
        },
        {
          name: "Oversized T-Shirt - Black",
          owned: false,
          priority: "High",
          brand: "Lady White Co.",
          season: "Warm Weather",
        },
        {
          name: "Oversized T-Shirt - White",
          owned: false,
          priority: "High",
          brand: "UNIQLO U",
          season: "Warm Weather",
        },
        {
          name: "Loose Fit Linen Shirt - Natural",
          owned: false,
          priority: "Medium",
          brand: "Story MFG",
          season: "Warm Weather",
        },
      ],
      Bottoms: [
        {
          name: "Baggy Jeans - Washed Black",
          owned: false,
          priority: "High",
          brand: "Levi's Silver Tab",
          season: "All Seasons",
        },
        {
          name: "Wide-Leg Wool Pants - Gray",
          owned: false,
          priority: "High",
          brand: "COS",
          season: "Cool Weather",
        },
        {
          name: "Baggy Cargo Pants - Olive",
          owned: false,
          priority: "Medium",
          brand: "Carhartt WIP",
          season: "All Seasons",
        },
        {
          name: "Wide-Leg Pants - Washed Blue",
          owned: false,
          priority: "High",
          brand: "OrSlow",
          season: "All Seasons",
        },
        {
          name: "Relaxed Denim - Gray",
          owned: false,
          priority: "Medium",
          brand: "Nanamica",
          season: "All Seasons",
        },
        {
          name: "Wide-Leg Work Pants - Black",
          owned: false,
          priority: "Medium",
          brand: "Stan Ray",
          season: "All Seasons",
        },
      ],
      Outerwear: [
        {
          name: "Oversized Leather Jacket - Black",
          owned: false,
          priority: "High",
          brand: "Vintage",
          season: "Boston Spring/SF Nights",
        },
        {
          name: "Oversized Wool Shirt Jacket - Brown Check",
          owned: false,
          priority: "High",
          brand: "Universal Works",
          season: "Cool Weather",
        },
        {
          name: "Padded Work Jacket - Black",
          owned: false,
          priority: "Medium",
          brand: "Snow Peak",
          season: "Boston Spring",
        },
        {
          name: "Lightweight Work Jacket - Indigo",
          owned: false,
          priority: "High",
          brand: "Blue Blue Japan",
          season: "All Seasons",
        },
        {
          name: "Oversized Denim Jacket - Washed Black",
          owned: false,
          priority: "Medium",
          brand: "Dickies",
          season: "All Seasons",
        },
        {
          name: "Light Chore Coat - Natural",
          owned: false,
          priority: "Medium",
          brand: "Le Laboureur",
          season: "SF Fog",
        },
      ],
      Footwear: [
        {
          name: "Chunky Leather Boots - Black",
          owned: false,
          priority: "Medium",
          brand: "Dr. Martens",
          season: "Cool Weather",
        },
        {
          name: "Low-Top Canvas Sneakers - Black",
          owned: false,
          priority: "Medium",
          brand: "Moonstar",
          season: "Warm Weather",
        },
        {
          name: "Chunky Loafers - Black",
          owned: false,
          priority: "Low",
          brand: "Paraboot",
          season: "All Seasons",
        },
      ],
      Accessories: [
        {
          name: "Loose Beanie - Gray",
          owned: false,
          priority: "Medium",
          brand: "Carhartt WIP",
          season: "Cool Weather",
        },
        {
          name: "Simple Leather Belt - Black",
          owned: false,
          priority: "Low",
          brand: "Knickerbocker",
          season: "All Seasons",
        },
        {
          name: "Canvas Tote - Natural",
          owned: false,
          priority: "Low",
          brand: "Arpenteur",
          season: "All Seasons",
        },
        {
          name: "Simple Cap - Black",
          owned: false,
          priority: "Low",
          brand: "Paa",
          season: "All Seasons",
        },
      ],
    },
  };

  // State for wardrobe and selected location/category
  const [wardrobe, setWardrobe] = useState<WardrobeData>(initialWardrobe);
  const [activeView, setActiveView] = useState("Current");
  const [activeCategory, setActiveCategory] = useState("All");
  const [activeSeason, setActiveSeason] = useState("All");
  const [showAddItemForm, setShowAddItemForm] = useState(false);
  const [newItemName, setNewItemName] = useState("");
  const [newItemCategory, setNewItemCategory] = useState("Tops");
  const [newItemPriority] = useState("Medium");
  const [newItemSeason, setNewItemSeason] = useState("All Seasons");

  // Toggle item ownership
  const toggleItemOwned = (
    location: string,
    category: string,
    index: number
  ) => {
    const updatedWardrobe = { ...wardrobe };
    if (
      updatedWardrobe[location] &&
      updatedWardrobe[location][category] &&
      updatedWardrobe[location][category][index]
    ) {
      updatedWardrobe[location][category][index].owned =
        !updatedWardrobe[location][category][index].owned;
      setWardrobe(updatedWardrobe);
    }
  };

  // Add new item
  const addNewItem = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newItemName.trim()) return;

    const updatedWardrobe = { ...wardrobe };
    if (!updatedWardrobe[activeView][newItemCategory]) {
      updatedWardrobe[activeView][newItemCategory] = [];
    }

    updatedWardrobe[activeView][newItemCategory].push({
      name: newItemName,
      owned: false,
      priority: newItemPriority,
      season: newItemSeason,
    });

    setWardrobe(updatedWardrobe);
    setNewItemName("");
    setShowAddItemForm(false);
  };

  // Remove item
  const removeItem = (location: string, category: string, index: number) => {
    const updatedWardrobe = { ...wardrobe };
    if (updatedWardrobe[location] && updatedWardrobe[location][category]) {
      updatedWardrobe[location][category].splice(index, 1);
      setWardrobe(updatedWardrobe);
    }
  };

  // Calculate completion percentage
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
    // No items to show on the Guide tab
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

    // Apply season filter if on Year-Round Collection and a season is selected
    if (activeView === "Year-Round Collection" && activeSeason !== "All") {
      filteredItems = filteredItems.filter(
        (item) => item.season === activeSeason || item.season === "All Seasons"
      );
    }

    return filteredItems;
  };

  // Color coding for priority
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

  return (
    <div className="w-full mx-auto p-4 bg-gray-50 min-h-screen">
      <h1 className="text-3xl font-bold mb-2 text-gray-800">
        Japanese Streetwear Wardrobe Builder
      </h1>
      <p className="mb-6 text-gray-600">
        Track your wardrobe transition from Boston to San Francisco
      </p>

      {activeView === "Guide" && (
        <Card className="mb-8">
          <CardContent className="p-6">
            <h2 className="text-2xl font-bold mb-4 text-gray-800">
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
                    <li>Mid layer: Oversized button-up or long-sleeve tee</li>
                    <li>
                      Outer layer: Leather jacket, wool shirt jacket, or work
                      jacket
                    </li>
                  </ul>
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-700">
                    For warmer days:
                  </p>
                  <ul className="text-sm text-gray-600 list-disc ml-6 space-y-1 mt-2">
                    <li>Single layer: Oversized tee or loose linen shirt</li>
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
                    (Levi's Silver Tab)
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
                    <span className="font-medium">Wide-leg pants</span> in a
                    different color (OrSlow)
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
      )}

      {/* Wardrobe views tabs */}
      <Tabs value={activeView} onValueChange={setActiveView} className="mb-4">
        <TabsList className="w-full justify-start border-b rounded-none bg-transparent p-0 h-auto">
          {wardrobeViews.map((view) => (
            <TabsTrigger
              key={view}
              value={view}
              onClick={() => {
                setActiveSeason("All"); // Reset season filter when changing view
              }}
              className="px-6 py-2 rounded-none border-0 data-[state=active]:border-b-2 data-[state=active]:border-primary data-[state=active]:shadow-none data-[state=active]:bg-transparent bg-transparent hover:bg-transparent text-foreground/70 data-[state=active]:text-foreground font-medium"
            >
              {view} {view !== "Current" && `(${calculateCompletion(view)}%)`}
            </TabsTrigger>
          ))}
        </TabsList>

        {wardrobeViews.map((view) => (
          <TabsContent key={view} value={view} className="pt-4">
            {/* Category filter */}
            <div className="flex flex-wrap gap-2 mb-6">
              <Button
                variant={activeCategory === "All" ? "default" : "outline"}
                size="sm"
                onClick={() => setActiveCategory("All")}
                className="rounded-full"
              >
                All
              </Button>
              {categories.map((category) => (
                <Button
                  key={category}
                  variant={activeCategory === category ? "default" : "outline"}
                  size="sm"
                  onClick={() => setActiveCategory(category)}
                  className="rounded-full"
                >
                  {category}
                </Button>
              ))}
            </div>

            {/* Season filter */}
            {view === "Year-Round Collection" && (
              <div className="mb-6">
                <h3 className="text-sm font-medium text-gray-700 mb-2">
                  Filter by Season:
                </h3>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant={activeSeason === "All" ? "default" : "outline"}
                    size="sm"
                    onClick={() => setActiveSeason("All")}
                    className="rounded-full text-xs"
                  >
                    All Seasons
                  </Button>
                  <Button
                    variant={
                      activeSeason === "All Seasons" ? "default" : "outline"
                    }
                    size="sm"
                    onClick={() => setActiveSeason("All Seasons")}
                    className="rounded-full text-xs"
                  >
                    Year Round
                  </Button>
                  <Button
                    variant={
                      activeSeason === "Cool Weather" ? "default" : "outline"
                    }
                    size="sm"
                    onClick={() => setActiveSeason("Cool Weather")}
                    className="rounded-full text-xs"
                  >
                    Cool Weather
                  </Button>
                  <Button
                    variant={
                      activeSeason === "Warm Weather" ? "default" : "outline"
                    }
                    size="sm"
                    onClick={() => setActiveSeason("Warm Weather")}
                    className="rounded-full text-xs"
                  >
                    Warm Weather
                  </Button>
                  <Button
                    variant={
                      activeSeason === "Boston Spring" ? "default" : "outline"
                    }
                    size="sm"
                    onClick={() => setActiveSeason("Boston Spring")}
                    className="rounded-full text-xs"
                  >
                    Boston Spring
                  </Button>
                  <Button
                    variant={activeSeason === "SF Fog" ? "default" : "outline"}
                    size="sm"
                    onClick={() => setActiveSeason("SF Fog")}
                    className="rounded-full text-xs"
                  >
                    SF Fog
                  </Button>
                </div>
              </div>
            )}

            {/* Add item button */}
            {view !== "Current" && (
              <Button
                onClick={() => setShowAddItemForm(!showAddItemForm)}
                className="mb-4"
              >
                {showAddItemForm ? "Cancel" : "Add New Item"}
              </Button>
            )}

            {/* Add item form */}
            {showAddItemForm && (
              <Card className="mb-6">
                <CardContent className="pt-6">
                  <form onSubmit={addNewItem} className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="itemName">Item Name</Label>
                        <Input
                          id="itemName"
                          value={newItemName}
                          onChange={(e) => setNewItemName(e.target.value)}
                          placeholder="Item name"
                          required
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="category">Category</Label>
                        <Select
                          value={newItemCategory}
                          onValueChange={setNewItemCategory}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Select category" />
                          </SelectTrigger>
                          <SelectContent>
                            {categories.map((category) => (
                              <SelectItem key={category} value={category}>
                                {category}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="season">Season</Label>
                        <Select
                          value={newItemSeason}
                          onValueChange={setNewItemSeason}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Select season" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="All Seasons">
                              All Seasons
                            </SelectItem>
                            <SelectItem value="Cool Weather">
                              Cool Weather
                            </SelectItem>
                            <SelectItem value="Warm Weather">
                              Warm Weather
                            </SelectItem>
                            <SelectItem value="Boston Spring">
                              Boston Spring
                            </SelectItem>
                            <SelectItem value="SF Fog">SF Fog</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <Button type="submit">Add Item</Button>
                  </form>
                </CardContent>
              </Card>
            )}

            {/* Items list */}
            <div className="space-y-2">
              {getFilteredItems().map((item: FilteredItem, i: number) => (
                <Card
                  key={`${item.category}-${item.index}-${i}`}
                  className={`${
                    item.owned ? "bg-green-50 border-l-4 border-green-500" : ""
                  }`}
                >
                  <CardContent className="p-3 flex items-center justify-between">
                    <div className="flex items-center">
                      <Checkbox
                        checked={item.owned}
                        onCheckedChange={() =>
                          toggleItemOwned(view, item.category, item.index)
                        }
                        className="h-5 w-5"
                      />
                      <div className="ml-3">
                        <p
                          className={`text-gray-800 ${
                            item.owned ? "line-through opacity-70" : ""
                          }`}
                        >
                          {item.name}
                        </p>
                        <div className="flex flex-wrap">
                          <p className="text-xs text-gray-500">
                            {item.category}
                          </p>
                          {item.brand && (
                            <p className="text-xs text-blue-600 ml-2">
                              {item.brand}
                            </p>
                          )}
                          {item.season && (
                            <p className="text-xs text-green-600 ml-2">
                              • {item.season}
                            </p>
                          )}
                        </div>
                      </div>
                      {item.priority && (
                        <Badge
                          className="ml-3"
                          variant={getPriorityColor(item.priority)}
                        >
                          {item.priority}
                        </Badge>
                      )}
                    </div>
                    {view !== "Current" && (
                      <Button
                        onClick={() =>
                          removeItem(view, item.category, item.index)
                        }
                        variant="ghost"
                        size="sm"
                        className="text-red-500 hover:text-red-700 p-0 h-auto"
                      >
                        ✕
                      </Button>
                    )}
                  </CardContent>
                </Card>
              ))}

              {getFilteredItems().length === 0 && (
                <div className="p-8 text-center text-gray-500">
                  No items found in this category.
                </div>
              )}
            </div>
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
};

export default WardrobeBuilder;
