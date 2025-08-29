// server.js
require("dotenv").config();
const express = require("express");
const path = require("path");
const { Pool } = require("pg");
const xlsx = require("xlsx");

const app = express();
const PORT = process.env.PORT || 3000;

// IMPORTANT: Use Environment Variables for your database connection string
// In Render.com, you will set this in the "Environment" tab.
// For local development, you can create a .env file (and use npm install dotenv)
const pool = new Pool({
  connectionString: process.env.DATABASE_URL, //postgresql://postgres.hbzskqkthjhmcbdpefvm:5450whitley20814@aws-1-us-east-1.pooler.supabase.com:5432/postgres
  ssl: {
    rejectUnauthorized: false,
  },
});

// Set up the view engine and middleware
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(express.urlencoded({ extended: true })); // To parse form data
app.use(express.json()); // To parse JSON for export endpoint

// The long list of options for the PRODUCTO select boxes
const productoOptions = [
  "ABANICO",
  "ABRIDOR",
  "ACCESORIOS",
  "ALARMA",
  "ALMOHADON",
  "ALTAVOZ",
  "AMPLIFICADOR DE TELÉFONO",
  "ARTÍCULOS DE OFICINA",
  "AUDÍFONOS CON CAJA PLÁSTICA",
  "AURICULARES",
  "AZUCARERA",
  "BANDEJA ANTIADHERENTE",
  "BALDE 5L",
  "BANNER",
  "BASE CARGADORA",
  "BATERIAS",
  "BANDANA",
  "BANDEROLA",
  "BOLÍGRAFO CÁPSULA",
  "BLOC DE NOTAS ADHESIVAS",
  "BOLIGRAFO CON LASER",
  "BACKPACK PARA LAPTOP",
  "BANDEJA METALICA",
  "BARMAT",
  "BANDEJA PLASTICA",
  "BOLSO",
  "BOTELLA PLASTICA",
  "BOWL",
  "BAR RAIL",
  "BROCHA",
  "BOLSA",
  "BUSCADOR DE LLAVES",
  "CABLE USB",
  "BAR CADDY",
  "CAJA CARTON",
  "CAMISA",
  "CAPOTA",
  "CARRIZO",
  "CUBETA",
  "CINTA CEFALICA",
  "CENEFA",
  "CHALECO",
  "CLAPPERS LED",
  "CUCHARA MEDIDORA",
  "COMPUTADORA",
  "COMEDERO",
  "CINTA MÉTRICA INTELIGENTE",
  "CARTEL DE NEON",
  "COASTER",
  "COCKTAIL SET",
  "COLLAR",
  "CARRY ON",
  "COOLER BAG",
  "COPA",
  "COVER",
  "CARPA",
  "CARRITO",
  "CARTUCHERA",
  "CARTEL",
  "CUBIERTOS",
  "CUCHARA",
  "DELANTAL",
  "DESTAPADOR",
  "DOMINO",
  "DRAWSTRING BAG",
  "DISFRAZ INFLABLE",
  "DISPLAY SAMSUNG",
  "ESTUCHE",
  "FLOWER POT",
  "FOAMBOARD",
  "FRISBEE",
  "FUENTE GATO",
  "SET DE GEOMETRIA",
  "GLOBO DE LATEX",
  "GLORIFICADOR",
  "GORRA MEDICA",
  "GORRA",
  "GUANTE",
  "HERMETICO",
  "MOLDE HIELO SILICONA",
  "HIELERA",
  "HOODIE",
  "HOLOGRAMA",
  "JACKET",
  "JARRA",
  "JIGGER",
  "JUEGO PARA GATO",
  "JUGUETE",
  "LANYARD",
  "LAPICERO",
  "LAZO DE REGALO",
  "LONCHERA",
  "LENTES",
  "LETRERO NEON",
  "LIBRETA",
  "SET LIMPIEZA",
  "LINTERNA",
  "LLAVERO",
  "LONA",
  "LIMPIA PATAS",
  "MANTA",
  "MEDIAS",
  "KIT MIXOLOGIA",
  "MASON JAR",
  "MINI LÁMPARA USB",
  "MOSCOW MULE",
  "MOBILIARIO",
  "MOCHILA",
  "MONITOR",
  "ANTI-SLIP MUG",
  "NOTEBOOK",
  "PAÑOLETA",
  "PARAGUAS",
  "PAPEL DE CAMILLA",
  "PELOTA",
  "PORTA GAFETE",
  "PHONE HOLDER",
  "PIN",
  "PIZARRA MAGNETICA",
  "PLATO",
  "PELUCHE",
  "MEDIA PLAYER",
  "PLACA METALICA",
  "PANTALLA",
  "POP SOCKET",
  "POSAVASOS",
  "POURER",
  "POWER BANK",
  "PELOTA ANTI ESTRES",
  "PORTA TARJETA CON SOPORTE CELULAR",
  "PULSERA CON LUZ LED",
  "RECIPIENTE",
  "T SHIRT",
  "ROTULO",
  "SANDWICHERA",
  "SOMBRERO",
  "SILLA PLAYERA CON COOLER",
  "SELLO",
  "SERVILLETERO",
  "SHAKER",
  "SILLA DE PLAYA",
  "SIPPY CUP",
  "SODA CAN",
  "SOMBRILLA",
  "SOPORTE DE CELULAR",
  "SPEAKER PORTÁTIL",
  "LEMON SQUIZZER",
  "STICKERS",
  "STIRRER",
  "SWEATER",
  "SUJETADOR CABLE",
  "TABLERO NEON",
  "TACHO",
  "TAZA",
  "TAZA CON CUCHARA",
  "TERMO",
  "TABLA PARA HOJA",
  "TOALLA",
  "TOTE BAG",
  "TUMBLER",
  "UNTADOR",
  "VASO ACRILICO",
  "SET DE VAJILLA",
  "MINI ECO VAP",
  "VASO",
  "VASO BIODEGRADABLE",
  "VASO CON CARRIZO",
  "VASO CERAMICA",
  "VASO ILUMINADO",
  "YOGA MAT",
  "YOYO",
  "PORTA QUESOS",
  "CUCHARON",
  "TABLA PARA QUESOS",
  "BOLA DE NAVIDAD",
  "ESTRELLA DE NAVIDAD",
  "ARBOL DE NAVIDAD",
  "DINER MAT",
  "PELOTA ANTIESTRES",
  "MEMO PAD",
  "RISTRAS",
];

// Main route to render the search page
app.get("/", (req, res) => {
  res.render("index", { productoOptions });
});

// Search route to handle the form submission
app.post("/search", async (req, res) => {
  const { producto1, producto2, producto3, descripcion, material, searchType } =
    req.body;

  const productos = [producto1, producto2, producto3].filter(
    (p) => p && p !== ""
  );

  let query = "SELECT * FROM products WHERE ";
  const queryParams = [];
  const conditions = [];
  let paramIndex = 1;

  // Build query for PRODUCTO
  if (productos.length > 0) {
    conditions.push(`producto ILIKE ANY($${paramIndex++})`);
    queryParams.push(productos.map((p) => `%${p}%`));
  }

  // Build query for DESCRIPCION
  if (descripcion) {
    conditions.push(
      `(product_description ILIKE $${paramIndex++} OR product_real_description ILIKE $${paramIndex++})`
    );
    queryParams.push(`%${descripcion}%`);
    queryParams.push(`%${descripcion}%`);
  }

  // Build query for MATERIAL
  if (material) {
    conditions.push(`material ILIKE $${paramIndex++}`);
    queryParams.push(`%${material}%`);
  }

  // If no conditions, return nothing
  if (conditions.length === 0) {
    return res.json({ results: [], title: "No search criteria provided." });
  }

  // Combine conditions with AND or OR
  const searchOperator = searchType === "AND" ? " AND " : " OR ";
  query += conditions.join(searchOperator);
  query += " ORDER BY id;";

  try {
    const { rows } = await pool.query(query, queryParams);

    // Create a summary title for the results
    const titleParts = [];
    if (productos.length > 0)
      titleParts.push(`PRODUCTO: ${productos.join(" or ")}`);
    if (descripcion) titleParts.push(`DESCRIPCION: ${descripcion}`);
    if (material) titleParts.push(`MATERIAL: ${material}`);
    const title = titleParts.join(` ${searchType} `);

    res.json({ results: rows, title: title });
  } catch (err) {
    console.error("Database query error", err.stack);
    res
      .status(500)
      .json({ error: "An error occurred while searching the database." });
  }
});

// Export route to generate an XLSX file
app.post("/export", async (req, res) => {
  const { ids } = req.body; // Expect an array of product IDs

  if (!ids || ids.length === 0) {
    return res.status(400).send("No records to export.");
  }

  try {
    // Query only the selected records by ID to ensure data integrity
    const query = "SELECT * FROM products WHERE id = ANY($1) ORDER BY id;";
    const { rows } = await pool.query(query, [ids]);

    // Convert the data to a worksheet
    const worksheet = xlsx.utils.json_to_sheet(rows);
    const workbook = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(workbook, worksheet, "Products");

    // Set headers to send the file back to the client
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader("Content-Disposition", "attachment; filename=products.xlsx");

    // Send the file
    const buffer = xlsx.write(workbook, { type: "buffer", bookType: "xlsx" });
    res.send(buffer);
  } catch (err) {
    console.error("Export error", err.stack);
    res.status(500).send("Error generating export file.");
  }
});

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
