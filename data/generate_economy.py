#!/usr/bin/env python3
"""
VAULT — Economy Data Generator
================================
Generates the full fictional economy as clean JSON the game engine imports.

Philosophy: we do NOT hand-type thousands of items. We define:
  1. BRANDS      — invented companies, each owning categories (fictional world)
  2. SECTORS     — top-level demand groups the news moves
  3. TAXONOMY    — sectors -> categories -> subcategories -> item leaves
  4. ARCHETYPES  — supply/price/elasticity rules by item *kind*
                   (a toothpick behaves nothing like an excavator)
Then we EXPAND deterministically into thousands of consistent item records.

Why this way: every item gets balanced, correct stats automatically; the data is
reproducible; you expand the world by editing rules, not 3,000 spreadsheet rows.

Run:  python3 generate_economy.py
Out:  ./data/brands.json, sectors.json, items.json, taxonomy.json, stats.json
"""

import json, os, random, hashlib

random.seed(7)  # deterministic output
OUT = os.path.join(os.path.dirname(__file__), "data")
os.makedirs(OUT, exist_ok=True)

# =============================================================================
# 1. SECTORS  — the demand groups news headlines move. Each item maps to one or
#    more sectors by weight; sector demand cascades down to every item under it.
# =============================================================================
SECTORS = {
    "construction":  {"label": "Construction",  "blurb": "Buildings, infrastructure, heavy materials"},
    "logistics":     {"label": "Logistics",     "blurb": "Freight, warehousing, handling, packaging"},
    "automotive":    {"label": "Automotive",    "blurb": "Vehicles, parts, tires, fluids"},
    "technology":    {"label": "Technology",    "blurb": "Compute, chips, networking, devices"},
    "energy":        {"label": "Energy",        "blurb": "Power, fuel, grid, storage"},
    "agriculture":   {"label": "Agriculture",   "blurb": "Farming, feed, crops, equipment"},
    "manufacturing": {"label": "Manufacturing", "blurb": "Industrial inputs, machining, fasteners"},
    "medical":       {"label": "Medical",       "blurb": "Devices, consumables, pharma supply"},
    "hospitality":   {"label": "Hospitality",   "blurb": "Restaurant, hotel, food service goods"},
    "consumer":      {"label": "Consumer",      "blurb": "Household, apparel, everyday goods"},
    "textiles":      {"label": "Textiles",      "blurb": "Fabric, fiber, raw cloth, leather"},
    "luxury":        {"label": "Luxury",        "blurb": "Collectibles, timepieces, fine goods"},
}

# =============================================================================
# 2. BRAND BIBLE — invented companies. Each brand has a "tier" (mass / mid /
#    premium / luxury) that flavors pricing, and the categories it supplies.
#    Brand names are generated from invented morphemes so the world is cohesive.
# =============================================================================

# morphemes to invent cohesive brand names
BRAND_PARTS_A = ["Brun","Forge","Hal","Marrow","Veldt","Cindra","Palett","Dross","Kessel","Varn",
                 "Holt","Grom","Aldous","Skarn","Wren","Castle","Vossen","Ferro","L穆".replace("穆",""),"Throne",
                 "Ironcrest","Black","Wold","Carrow","Dunmore","Ashby","Korr","Steg","Marl","Ven",
                 "Crane","Hesper","Thal","Orne","Bramm","Calder","Drust","Erret","Fenn","Garr"]
BRAND_PARTS_B = ["haus","wright","cyon","gear","ridge","forge","gate","mark","line","works",
                 "stead","field","crest","mont","ware","craft","born","grave","hold","stone",
                 "well","ford","ton","dale","moor","spire","reach","fall","vale","grove"]
BRAND_SUFFIX = ["","","",""," Industries"," Co."," Group"," & Sons"," Supply"," Holdings"," Works"," Mfg."]

def make_brand_name(seed):
    r = random.Random(seed)
    a = r.choice(BRAND_PARTS_A); b = r.choice(BRAND_PARTS_B); s = r.choice(BRAND_SUFFIX)
    name = a + b + s
    return name

TIERS = {
    "mass":    {"price_mult": 0.85, "weight": 4},   # cheap, ubiquitous
    "mid":     {"price_mult": 1.0,  "weight": 3},
    "premium": {"price_mult": 1.35, "weight": 2},
    "luxury":  {"price_mult": 2.4,  "weight": 1},    # collectibles, editions
}

# =============================================================================
# 3. ARCHETYPES — the supply spine. An archetype defines how a *kind* of good
#    behaves: base price range, how much stock normally sits on the floor, how
#    fast it restocks, and price elasticity. This is what makes toothpicks
#    stable-and-infinite while excavators are scarce-and-swingy.
#
#    fields: price (lo,hi), stock (lo,hi), restock_frac (of stock/cycle),
#            edition_chance (rare chance a given item is a finite collectible)
# =============================================================================
ARCHETYPES = {
    # tiny consumables — pennies, oceans of stock, restock fast, never scarce
    "micro_consumable": {"price": (0.01, 0.50),  "stock": (200000, 900000), "restock_frac": (0.12, 0.20), "edition_chance": 0.0},
    # bulk consumable — cheap, huge stock (toothpicks, gloves, cups, screws)
    "bulk_consumable":  {"price": (0.50, 8),      "stock": (60000, 250000),  "restock_frac": (0.08, 0.16), "edition_chance": 0.0},
    # commodity material — raw inputs sold by unit (steel sheet, copper, rubber)
    "commodity":        {"price": (8, 400),       "stock": (5000, 40000),    "restock_frac": (0.05, 0.12), "edition_chance": 0.0},
    # component — mid goods (controllers, pumps, fixtures, light tools)
    "component":        {"price": (60, 3000),     "stock": (1500, 12000),    "restock_frac": (0.04, 0.09), "edition_chance": 0.002},
    # light equipment — (forklifts attachments, generators, drones, appliances)
    "light_equipment":  {"price": (1500, 25000),  "stock": (200, 1800),      "restock_frac": (0.02, 0.05), "edition_chance": 0.004},
    # heavy equipment — (excavators, trucks, server racks, industrial machines)
    "heavy_equipment":  {"price": (25000, 400000),"stock": (20, 320),        "restock_frac": (0.008, 0.025),"edition_chance": 0.006},
    # vehicle — cars/trucks (depreciating bias handled in engine via sector)
    "vehicle":          {"price": (9000, 120000), "stock": (60, 900),        "restock_frac": (0.01, 0.04), "edition_chance": 0.01},
    # luxury good — watches, fine goods; small stock, can be editioned
    "luxury_good":      {"price": (3000, 90000),  "stock": (40, 600),        "restock_frac": (0.01, 0.03), "edition_chance": 0.05},
    # collectible — frequently a finite edition (the gold)
    "collectible":      {"price": (8000, 300000), "stock": (1, 12),          "restock_frac": (0.0, 0.0),  "edition_chance": 0.85},
}

# icon pools by rough family (engine just shows an emoji; cosmetic)
ICONS = {
    "fastener":"🔩","screw":"🪛","material":"⬜","metal":"🟨","pipe":"🟤","wood":"🪵","plastic":"🧴",
    "glass":"🔷","textile":"🧵","rubber":"⚫","paper":"📄","box":"📦","pallet":"🟫","food":"🍽️",
    "glove":"🧤","tool":"🛠️","pump":"🌀","valve":"🎛️","wire":"🔌","cable":"🧶","chip":"💾",
    "server":"🖥️","drone":"🛸","battery":"🔋","panel":"🟦","light":"💡","truck":"🚚","car":"🚗",
    "sport":"🏎️","tractor":"🚜","excavator":"🏗️","crane":"🏗️","watch":"⌚","gem":"💎","ingot":"🟨",
    "med":"💊","syringe":"💉","mask":"😷","seed":"🌱","feed":"🌾","fuel":"⛽","generator":"⚡",
    "appliance":"🧰","fixture":"🚿","tile":"🔲","brick":"🧱","cement":"🪨","fiber":"🧶","default":"📦",
}

# =============================================================================
# 4. TAXONOMY — sectors -> categories -> subcategories -> item leaves.
#    Each leaf is (item_base_name, archetype, icon_key). The generator multiplies
#    leaves across BRANDS and VARIANTS to reach thousands of concrete items.
#
#    This is large but readable; expand any branch to grow the world.
#    Format: CATEGORY: { "sectors": {sector:weight}, "subs": { SUB: [leaves] } }
# =============================================================================

def L(name, arch, icon): return {"name": name, "arch": arch, "icon": icon}

TAXONOMY = {
 # ---------------- CONSTRUCTION ----------------
 "Fasteners & Fixings": {"sectors":{"construction":1,"manufacturing":.6,"automotive":.3}, "subs":{
    "Bolts": [L("Hex Bolt M6","bulk_consumable","fastener"),L("Hex Bolt M12","bulk_consumable","fastener"),
              L("Carriage Bolt","bulk_consumable","fastener"),L("Anchor Bolt","commodity","fastener"),
              L("U-Bolt","bulk_consumable","fastener"),L("Eye Bolt","bulk_consumable","fastener")],
    "Screws": [L("Wood Screw #8","micro_consumable","screw"),L("Drywall Screw","micro_consumable","screw"),
               L("Machine Screw","micro_consumable","screw"),L("Self-Tapping Screw","micro_consumable","screw"),
               L("Deck Screw","bulk_consumable","screw"),L("Lag Screw","bulk_consumable","screw")],
    "Nails & Rivets": [L("Common Nail 3in","micro_consumable","fastener"),L("Finish Nail","micro_consumable","fastener"),
               L("Roofing Nail","micro_consumable","fastener"),L("Pop Rivet","micro_consumable","fastener"),
               L("Blind Rivet","micro_consumable","fastener")],
    "Nuts & Washers": [L("Hex Nut M12","micro_consumable","fastener"),L("Lock Nut","micro_consumable","fastener"),
               L("Flat Washer","micro_consumable","fastener"),L("Spring Washer","micro_consumable","fastener"),
               L("Wing Nut","micro_consumable","fastener")],
 }},
 "Structural Materials": {"sectors":{"construction":1,"manufacturing":.4,"energy":.2}, "subs":{
    "Steel": [L("Steel Plate 4x8","commodity","material"),L("Steel I-Beam 20ft","commodity","material"),
              L("Steel Rebar Bundle","commodity","metal"),L("Steel Tube Section","commodity","material"),
              L("Galvanized Sheet","commodity","material"),L("Steel Angle Stock","commodity","material")],
    "Concrete & Masonry": [L("Cement Bag 80lb","bulk_consumable","cement"),L("Concrete Block","commodity","brick"),
              L("Clay Brick Pallet","commodity","brick"),L("Mortar Mix","bulk_consumable","cement"),
              L("Paver Stone","commodity","tile"),L("Rebar Mesh Sheet","commodity","metal")],
    "Lumber": [L("Pine 2x4 Stud","bulk_consumable","wood"),L("Plywood Sheet","commodity","wood"),
              L("OSB Board","commodity","wood"),L("Hardwood Plank","commodity","wood"),
              L("Pressure-Treated Post","commodity","wood")],
    "Insulation & Board": [L("Fiberglass Batt","bulk_consumable","fiber"),L("Drywall Sheet","commodity","material"),
              L("Foam Board","bulk_consumable","plastic"),L("Mineral Wool Roll","bulk_consumable","fiber")],
 }},
 "Plumbing & Fixtures": {"sectors":{"construction":.8,"consumer":.3,"hospitality":.3}, "subs":{
    "Pipe": [L("Copper Pipe 10ft","commodity","pipe"),L("PVC Pipe 10ft","bulk_consumable","pipe"),
             L("PEX Tubing Roll","bulk_consumable","pipe"),L("Cast Iron Pipe","commodity","pipe"),
             L("Galvanized Pipe","commodity","pipe")],
    "Valves & Fittings": [L("Ball Valve","component","valve"),L("Gate Valve","component","valve"),
             L("Pipe Elbow Fitting","bulk_consumable","valve"),L("Coupling Fitting","bulk_consumable","valve"),
             L("Pressure Regulator","component","valve")],
    "Fixtures": [L("Kitchen Faucet","component","fixture"),L("Shower Valve Set","component","fixture"),
             L("Toilet Assembly","component","fixture"),L("Utility Sink","component","fixture")],
 }},

 # ---------------- ELECTRICAL / ENERGY ----------------
 "Wire & Cable": {"sectors":{"construction":.6,"energy":.7,"technology":.5,"automotive":.3}, "subs":{
    "Building Wire": [L("Copper Wire Spool 12AWG","commodity","wire"),L("THHN Wire 10AWG","commodity","wire"),
             L("Romex Cable Roll","commodity","cable"),L("Aluminum Feeder Wire","commodity","wire")],
    "Data & Fiber": [L("Cat6 Ethernet Spool","commodity","cable"),L("Cat7 Cable Roll","commodity","cable"),
             L("Fiber Optic Cable Spool","component","cable"),L("Coaxial Cable Roll","commodity","cable"),
             L("Patch Cable Bundle","bulk_consumable","cable")],
    "Connectors": [L("RJ45 Connector Pack","micro_consumable","wire"),L("Wire Nut Assortment","micro_consumable","wire"),
             L("Terminal Block","bulk_consumable","wire"),L("Cable Gland Set","bulk_consumable","wire")],
 }},
 "Lighting": {"sectors":{"consumer":.6,"construction":.4,"hospitality":.4,"energy":.3}, "subs":{
    "Bulbs": [L("LED Bulb A19","bulk_consumable","light"),L("Halogen Bulb","bulk_consumable","light"),
             L("Fluorescent Tube","bulk_consumable","light"),L("Smart Bulb","component","light"),
             L("Flood Lamp","bulk_consumable","light")],
    "Fixtures": [L("Recessed Downlight","component","light"),L("LED Panel Fixture","component","light"),
             L("Shop Light Fixture","component","light"),L("Pendant Fixture","component","light")],
 }},
 "Power & Storage": {"sectors":{"energy":1,"technology":.4,"automotive":.4}, "subs":{
    "Batteries": [L("AA Battery Pack","bulk_consumable","battery"),L("Lithium Cell 18650","bulk_consumable","battery"),
             L("Car Battery","component","battery"),L("EV Battery Pack","light_equipment","battery"),
             L("Grid Storage Module","heavy_equipment","battery")],
    "Generation": [L("Portable Generator","light_equipment","generator"),L("Diesel Genset","heavy_equipment","generator"),
             L("Solar Panel 400W","component","panel"),L("Solar Array Pallet","light_equipment","panel"),
             L("Wind Micro-Turbine","light_equipment","generator")],
    "Fuel": [L("Diesel Drum 55gal","commodity","fuel"),L("Propane Tank","bulk_consumable","fuel"),
             L("Gasoline Barrel","commodity","fuel"),L("Lubricant Drum","commodity","fuel")],
 }},

 # ---------------- LOGISTICS ----------------
 "Packaging": {"sectors":{"logistics":1,"consumer":.3,"hospitality":.3}, "subs":{
    "Boxes & Mailers": [L("Cardboard Box Bundle","bulk_consumable","box"),L("Padded Mailer Pack","bulk_consumable","box"),
             L("Shipping Carton","bulk_consumable","box"),L("Moving Box Kit","bulk_consumable","box")],
    "Wrap & Tape": [L("Stretch Wrap Roll","bulk_consumable","paper"),L("Bubble Wrap Roll","bulk_consumable","plastic"),
             L("Packing Tape Case","bulk_consumable","paper"),L("Strapping Band Coil","commodity","material")],
    "Pallets & Crates": [L("Shipping Pallet","commodity","pallet"),L("Plastic Pallet","commodity","pallet"),
             L("Wooden Crate","commodity","box"),L("Bulk Container Bin","component","box")],
 }},
 "Material Handling": {"sectors":{"logistics":1,"construction":.4,"manufacturing":.4}, "subs":{
    "Manual": [L("Hand Truck","component","tool"),L("Pallet Jack","component","tool"),
             L("Utility Cart","component","tool"),L("Furniture Dolly","bulk_consumable","tool")],
    "Powered": [L("Electric Forklift","heavy_equipment","tractor"),L("Reach Truck","heavy_equipment","tractor"),
             L("Order Picker","heavy_equipment","tractor"),L("Walkie Stacker","light_equipment","tractor"),
             L("Conveyor Section","light_equipment","tool")],
    "Autonomous": [L("Warehouse AMR Bot","light_equipment","drone"),L("Cargo Drone","light_equipment","drone"),
             L("Sortation Robot","heavy_equipment","drone")],
 }},

 # ---------------- AUTOMOTIVE ----------------
 "Vehicles": {"sectors":{"automotive":1,"luxury":.3,"logistics":.3}, "subs":{
    "Passenger": [L("Compact Sedan","vehicle","car"),L("Family SUV","vehicle","car"),
             L("Electric Hatchback","vehicle","car"),L("Pickup Truck","vehicle","truck")],
    "Commercial": [L("Box Truck","vehicle","truck"),L("Delivery Van","vehicle","truck"),
             L("Semi Tractor","heavy_equipment","truck"),L("Refrigerated Truck","heavy_equipment","truck")],
    "Performance": [L("Sport Coupe","vehicle","sport"),L("Roadster","vehicle","sport"),
             L("Track Special","collectible","sport"),L("Concept GT","collectible","sport")],
 }},
 "Auto Parts": {"sectors":{"automotive":1,"manufacturing":.4}, "subs":{
    "Drivetrain": [L("Brake Pad Set","component","tool"),L("Clutch Kit","component","tool"),
             L("Alternator","component","tool"),L("Starter Motor","component","tool")],
    "Tires & Rubber": [L("All-Season Tire","component","rubber"),L("Performance Tire","component","rubber"),
             L("Truck Tire","component","rubber"),L("Rubber Compound Bale","commodity","rubber"),
             L("Inner Tube Pack","bulk_consumable","rubber")],
    "Fluids": [L("Motor Oil Case","bulk_consumable","fuel"),L("Coolant Jug","bulk_consumable","fuel"),
             L("Brake Fluid Case","bulk_consumable","fuel"),L("Transmission Fluid","bulk_consumable","fuel")],
 }},

 # ---------------- TECHNOLOGY ----------------
 "Compute": {"sectors":{"technology":1,"energy":.3}, "subs":{
    "Servers": [L("1U Rack Server","heavy_equipment","server"),L("Server Rack 42U","heavy_equipment","server"),
             L("Blade Chassis","heavy_equipment","server"),L("Storage Array","heavy_equipment","server"),
             L("Edge Compute Node","light_equipment","server")],
    "Components": [L("GPU Accelerator","light_equipment","chip"),L("CPU Tray","component","chip"),
             L("Memory Module Pack","component","chip"),L("SSD Drive Pack","component","chip"),
             L("Microcontroller Tray","commodity","chip")],
    "Networking": [L("Network Switch 48-port","component","server"),L("Router Appliance","component","server"),
             L("Wireless Access Point","bulk_consumable","server"),L("Optical Transceiver Pack","component","chip")],
 }},
 "Devices": {"sectors":{"technology":.8,"consumer":.6}, "subs":{
    "Personal": [L("Smartphone","component","chip"),L("Laptop","component","chip"),
             L("Tablet","component","chip"),L("Smartwatch","component","watch")],
    "Peripherals": [L("Mechanical Keyboard","bulk_consumable","tool"),L("Monitor 27in","component","server"),
             L("Webcam Pack","bulk_consumable","chip"),L("USB Hub Pack","micro_consumable","wire")],
 }},

 # ---------------- AGRICULTURE ----------------
 "Farm Inputs": {"sectors":{"agriculture":1,"consumer":.2}, "subs":{
    "Seed & Feed": [L("Corn Seed Sack","bulk_consumable","seed"),L("Wheat Seed Sack","bulk_consumable","seed"),
             L("Livestock Feed Bag","bulk_consumable","feed"),L("Fertilizer Sack","bulk_consumable","feed"),
             L("Soy Seed Sack","bulk_consumable","seed")],
    "Crop Protection": [L("Pesticide Jug","commodity","fuel"),L("Herbicide Drum","commodity","fuel"),
             L("Greenhouse Film Roll","commodity","plastic")],
 }},
 "Farm Equipment": {"sectors":{"agriculture":1,"manufacturing":.3}, "subs":{
    "Tractors": [L("Utility Tractor","heavy_equipment","tractor"),L("Row-Crop Tractor","heavy_equipment","tractor"),
             L("Compact Tractor","light_equipment","tractor")],
    "Implements": [L("Plow Attachment","light_equipment","tool"),L("Seed Drill","light_equipment","tool"),
             L("Harvester Header","heavy_equipment","tool"),L("Irrigation Pump","component","pump")],
 }},

 # ---------------- HEAVY / INDUSTRIAL ----------------
 "Earthmoving": {"sectors":{"construction":1,"energy":.3,"agriculture":.3}, "subs":{
    "Excavation": [L("Mini Excavator","heavy_equipment","excavator"),L("Crawler Excavator","heavy_equipment","excavator"),
             L("Backhoe Loader","heavy_equipment","excavator"),L("Skid Steer","light_equipment","excavator")],
    "Lifting": [L("Mobile Crane","heavy_equipment","crane"),L("Tower Crane Section","heavy_equipment","crane"),
             L("Telehandler","heavy_equipment","tractor"),L("Boom Lift","light_equipment","crane")],
    "Compaction": [L("Plate Compactor","light_equipment","tool"),L("Road Roller","heavy_equipment","tractor")],
 }},
 "Industrial Machines": {"sectors":{"manufacturing":1,"technology":.3}, "subs":{
    "Machining": [L("CNC Mill","heavy_equipment","tool"),L("Lathe","heavy_equipment","tool"),
             L("Press Brake","heavy_equipment","tool"),L("Industrial 3D Printer","light_equipment","tool")],
    "Fluid & Air": [L("Air Compressor","light_equipment","pump"),L("Hydraulic Pump Unit","component","pump"),
             L("Industrial Pump","component","pump"),L("Vacuum Pump","component","pump")],
 }},

 # ---------------- MEDICAL ----------------
 "Medical Consumables": {"sectors":{"medical":1,"hospitality":.2}, "subs":{
    "PPE": [L("Nitrile Glove Box","bulk_consumable","glove"),L("Surgical Mask Case","bulk_consumable","mask"),
             L("Face Shield Pack","bulk_consumable","mask"),L("Isolation Gown Pack","bulk_consumable","textile")],
    "Disposables": [L("Syringe Pack","bulk_consumable","syringe"),L("IV Set","bulk_consumable","med"),
             L("Gauze Roll Case","bulk_consumable","med"),L("Bandage Pack","bulk_consumable","med")],
 }},
 "Medical Equipment": {"sectors":{"medical":1,"technology":.3}, "subs":{
    "Devices": [L("Infusion Pump","component","pump"),L("Patient Monitor","component","server"),
             L("Ventilator","light_equipment","pump"),L("Ultrasound Unit","light_equipment","server")],
    "Imaging": [L("Portable X-Ray","heavy_equipment","server"),L("CT Scanner","collectible","server")],
 }},

 # ---------------- HOSPITALITY / FOOD SERVICE ----------------
 "Food Service": {"sectors":{"hospitality":1,"consumer":.4}, "subs":{
    "Disposables": [L("Toothpick Box","micro_consumable","food"),L("Paper Napkin Case","micro_consumable","paper"),
             L("Plastic Cup Sleeve","micro_consumable","plastic"),L("Takeout Container Case","bulk_consumable","box"),
             L("Drinking Straw Box","micro_consumable","plastic"),L("Paper Plate Case","bulk_consumable","paper")],
    "Tableware": [L("Dinner Plate Set","bulk_consumable","food"),L("Flatware Set","bulk_consumable","tool"),
             L("Drinking Glass Rack","bulk_consumable","glass"),L("Serving Tray","bulk_consumable","food")],
    "Kitchen Equipment": [L("Commercial Range","light_equipment","appliance"),L("Reach-In Fridge","light_equipment","appliance"),
             L("Deep Fryer","component","appliance"),L("Dish Machine","light_equipment","appliance"),
             L("Prep Table","component","tool")],
 }},
 "Cleaning & Jansan": {"sectors":{"hospitality":.7,"consumer":.5,"medical":.3}, "subs":{
    "Supplies": [L("Latex Glove Box","bulk_consumable","glove"),L("Cleaning Spray Case","bulk_consumable","plastic"),
             L("Paper Towel Case","bulk_consumable","paper"),L("Trash Bag Roll Case","bulk_consumable","plastic"),
             L("Floor Cleaner Drum","commodity","fuel")],
    "Equipment": [L("Floor Scrubber","light_equipment","appliance"),L("Vacuum Unit","component","appliance"),
             L("Janitor Cart","bulk_consumable","tool")],
 }},

 # ---------------- TEXTILES ----------------
 "Raw Textiles": {"sectors":{"textiles":1,"manufacturing":.3,"consumer":.3}, "subs":{
    "Fiber & Cloth": [L("Cotton Bale","commodity","textile"),L("Polyester Fiber Bale","commodity","fiber"),
             L("Denim Bolt","commodity","textile"),L("Canvas Roll","commodity","textile"),
             L("Wool Bale","commodity","textile"),L("Silk Bolt","component","textile")],
    "Leather": [L("Cowhide Leather","component","textile"),L("Synthetic Leather Roll","commodity","textile")],
    "Notions": [L("Zipper Spool","bulk_consumable","tool"),L("Button Assortment","micro_consumable","tool"),
             L("Thread Cone Pack","bulk_consumable","fiber")],
 }},
 "Apparel Goods": {"sectors":{"consumer":1,"textiles":.5}, "subs":{
    "Basics": [L("Cotton T-Shirt Pack","bulk_consumable","textile"),L("Work Glove Pack","bulk_consumable","glove"),
             L("Sock Bundle","bulk_consumable","textile"),L("Uniform Set","component","textile")],
    "Footwear": [L("Work Boot","component","textile"),L("Running Shoe","component","textile"),
             L("Safety Boot Case","component","textile")],
 }},

 # ---------------- CONSUMER / HOUSEHOLD ----------------
 "Household Goods": {"sectors":{"consumer":1,"hospitality":.2}, "subs":{
    "Kitchen": [L("Cookware Set","bulk_consumable","appliance"),L("Storage Container Set","bulk_consumable","plastic"),
             L("Knife Block Set","bulk_consumable","tool"),L("Small Appliance","component","appliance")],
    "Home": [L("Bath Towel Set","bulk_consumable","textile"),L("Bedding Set","bulk_consumable","textile"),
             L("Area Rug","component","textile"),L("Storage Shelf Unit","bulk_consumable","tool")],
 }},
 "Hardware & Tools": {"sectors":{"consumer":.6,"construction":.6,"manufacturing":.4}, "subs":{
    "Hand Tools": [L("Claw Hammer","bulk_consumable","tool"),L("Screwdriver Set","bulk_consumable","tool"),
             L("Wrench Set","bulk_consumable","tool"),L("Tape Measure Pack","bulk_consumable","tool"),
             L("Utility Knife Pack","micro_consumable","tool")],
    "Power Tools": [L("Cordless Drill","component","tool"),L("Circular Saw","component","tool"),
             L("Angle Grinder","component","tool"),L("Impact Driver","component","tool")],
    "Abrasives & Misc": [L("Sandpaper Pack","micro_consumable","material"),L("Cutting Disc Pack","bulk_consumable","material"),
             L("Duct Tape Case","bulk_consumable","paper"),L("Adhesive Tube Case","bulk_consumable","plastic")],
 }},

 # ---------------- LUXURY / COLLECTIBLE ----------------
 "Timepieces": {"sectors":{"luxury":1}, "subs":{
    "Watches": [L("Field Watch","luxury_good","watch"),L("Dive Watch","luxury_good","watch"),
             L("Chronograph","luxury_good","watch"),L("Moonphase","collectible","watch"),
             L("Tourbillon","collectible","watch"),L("Skeleton Watch","collectible","watch")],
 }},
 "Fine Goods": {"sectors":{"luxury":1,"consumer":.2}, "subs":{
    "Precious": [L("Gold Ingot","luxury_good","ingot"),L("Silver Bar","luxury_good","ingot"),
             L("Cut Diamond","collectible","gem"),L("Sapphire","collectible","gem"),
             L("Founder's Medallion","collectible","gem")],
    "Objects": [L("Fountain Pen","luxury_good","tool"),L("Leather Attaché","luxury_good","textile"),
             L("Crystal Decanter","luxury_good","glass")],
 }},
}

# =============================================================================
# 5. EXPANSION — multiply leaves across brands + variants into concrete items.
# =============================================================================

# variant modifiers add believable spread without manual typing
VARIANTS = {
    "micro_consumable": ["", "Bulk Case", "Contractor Pack", "Economy Box"],
    "bulk_consumable":  ["", "Case", "Pallet", "Pro Pack"],
    "commodity":        ["", "Mill Grade", "Industrial", "Premium"],
    "component":        ["", "Mk II", "Pro", "HD"],
    "light_equipment":  ["", "Series 2", "XR"],
    "heavy_equipment":  ["", "HD", "Series X"],
    "vehicle":          ["", "Touring", "Sport", "Limited"],
    "luxury_good":      ["", "Reserve", "Heritage"],
    "collectible":      ["", "№1", "Prototype"],
}

# how many brands compete in each category (variety without explosion)
BRANDS_PER_CATEGORY = 5

def hsh(*parts):
    return int(hashlib.md5("|".join(map(str,parts)).encode()).hexdigest(),16)

def pick_tier(arch, r):
    if arch in ("collectible",): return "luxury"
    if arch in ("luxury_good",): return r.choice(["premium","luxury"])
    if arch in ("heavy_equipment","vehicle"): return r.choice(["mid","premium"])
    if arch in ("micro_consumable","bulk_consumable"): return r.choice(["mass","mass","mid"])
    return r.choice(["mass","mid","mid","premium"])

BRANDS_PER_SECTOR = 9   # a pool of brands per sector; categories draw from it

def build_brand_pools():
    """Each sector gets a pool of invented brands. A category draws its competing
    brands from the pools of the sectors it belongs to — so a brand naturally
    spans several related categories (a real company with a product line)."""
    pools = {}
    used = set()
    for si, sector in enumerate(SECTORS):
        pool = []
        for bi in range(BRANDS_PER_SECTOR):
            seed = hsh("sector", sector, bi); tries=0
            name = make_brand_name(seed)
            while name in used and tries<8:
                tries+=1; name = make_brand_name(hsh("sector",sector,bi,tries))
            used.add(name); pool.append(name)
        pools[sector] = pool
    return pools

def gen_items():
    brands_registry = {}   # name -> {tier, categories:set, sectors:set}
    items = []
    item_id = 0
    brand_pools = build_brand_pools()

    for category, cdef in TAXONOMY.items():
        sectors = cdef["sectors"]
        # draw this category's competing brands from the pools of ITS sectors,
        # weighted toward the primary sector — so brands recur across related cats.
        ranked = sorted(sectors.items(), key=lambda kv:-kv[1])
        cat_brands = []
        rc = random.Random(hsh("catbrands", category))
        for s,_w in ranked:
            for b in brand_pools[s]:
                if b not in cat_brands:
                    cat_brands.append(b)
        rc.shuffle(cat_brands)
        cat_brands = cat_brands[:BRANDS_PER_CATEGORY]

        for sub, leaves in cdef["subs"].items():
            for leaf in leaves:
                arch = leaf["arch"]
                a = ARCHETYPES[arch]
                variants = VARIANTS.get(arch, [""])
                # not every leaf gets every brand×variant — sample to control size
                combos = []
                for b in cat_brands:
                    for v in variants:
                        combos.append((b, v))
                r0 = random.Random(hsh(category, sub, leaf["name"]))
                r0.shuffle(combos)
                # keep a believable number of competing SKUs per leaf
                keep = max(3, min(len(combos), 6 if arch in ("micro_consumable","bulk_consumable","commodity") else 4))
                for (brand, variant) in combos[:keep]:
                    r = random.Random(hsh(brand, variant, leaf["name"], item_id))
                    tier = pick_tier(arch, r)
                    tinfo = TIERS[tier]
                    # price within archetype range, scaled by tier
                    plo, phi = a["price"]
                    price = round(r.uniform(plo, phi) * tinfo["price_mult"], 2)
                    # stock + restock
                    slo, shi = a["stock"]; stock = int(r.uniform(slo, shi))
                    rf_lo, rf_hi = a["restock_frac"]; restock = int(stock * r.uniform(rf_lo, rf_hi))
                    # edition? only meaningful for prestige archetypes — a "1 of 8 ball valve"
                    # is silly, so gate editions to goods where scarcity reads as collectible.
                    edition_ok = arch in ("collectible","luxury_good","vehicle","heavy_equipment")
                    is_edition = edition_ok and (r.random() < a["edition_chance"])
                    if is_edition:
                        edition = r.choice([1,1,2,3,3,5,8,12])
                        stock = edition; restock = 0
                    else:
                        edition = None
                    # elaborateness (drives volatility beta + collectible glow) 0..1
                    base_elab = {"micro_consumable":.05,"bulk_consumable":.1,"commodity":.2,
                                 "component":.35,"light_equipment":.5,"heavy_equipment":.65,
                                 "vehicle":.6,"luxury_good":.8,"collectible":.97}[arch]
                    elaborate = round(min(1.0, base_elab + r.uniform(-.05,.08)), 3)

                    full_name = (variant + " " + leaf["name"]).strip() if variant else leaf["name"]
                    items.append({
                        "id": item_id,
                        "name": full_name,
                        "brand": brand,
                        "tier": tier,
                        "category": category,
                        "sub": sub,
                        "archetype": arch,
                        "icon": ICONS.get(leaf["icon"], ICONS["default"]),
                        "weights": sectors,
                        "base": price,
                        "stockNormal": stock,
                        "restock": restock,
                        "edition": edition,
                        "elaborate": elaborate,
                    })
                    # register brand
                    br = brands_registry.setdefault(brand, {"tiers":set(),"categories":set(),"sectors":set()})
                    br["tiers"].add(tier); br["categories"].add(category)
                    for s in sectors: br["sectors"].add(s)
                    item_id += 1

    # finalize brand bible
    brands = []
    for name, info in sorted(brands_registry.items()):
        # a brand's headline sector = the sector it appears in most
        sector_counts = {}
        for it in items:
            if it["brand"]==name:
                for s in it["weights"]: sector_counts[s]=sector_counts.get(s,0)+1
        home = max(sector_counts, key=sector_counts.get) if sector_counts else None
        brands.append({
            "name": name,
            "homeSector": home,
            "tiers": sorted(info["tiers"]),
            "categories": sorted(info["categories"]),
            "sectors": sorted(info["sectors"]),
        })

    return items, brands

def main():
    items, brands = gen_items()

    # taxonomy export (sector -> categories -> subs -> leaf names)
    tax_export = {}
    for cat, cdef in TAXONOMY.items():
        tax_export[cat] = {
            "sectors": cdef["sectors"],
            "subs": {sub:[l["name"] for l in leaves] for sub,leaves in cdef["subs"].items()}
        }

    json.dump(SECTORS, open(f"{OUT}/sectors.json","w"), indent=2)
    json.dump(brands,  open(f"{OUT}/brands.json","w"),  indent=2)
    json.dump(items,   open(f"{OUT}/items.json","w"),   indent=2)
    json.dump(tax_export, open(f"{OUT}/taxonomy.json","w"), indent=2)

    # stats summary
    by_arch={}; by_sector={}; editions=0
    for it in items:
        by_arch[it["archetype"]]=by_arch.get(it["archetype"],0)+1
        if it["edition"] is not None: editions+=1
        for s in it["weights"]: by_sector[s]=by_sector.get(s,0)+1
    stats={
        "total_items": len(items),
        "total_brands": len(brands),
        "total_sectors": len(SECTORS),
        "total_categories": len(TAXONOMY),
        "total_subcategories": sum(len(c["subs"]) for c in TAXONOMY.values()),
        "editions": editions,
        "items_by_archetype": by_arch,
        "item_appearances_by_sector": by_sector,
        "price_range": [min(i["base"] for i in items), max(i["base"] for i in items)],
    }
    json.dump(stats, open(f"{OUT}/stats.json","w"), indent=2)

    print(json.dumps(stats, indent=2))

if __name__=="__main__":
    main()
