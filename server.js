// server.js
require("dotenv").config();
const express = require("express");
const path = require("path");
const { Pool } = require("pg");
const xlsx = require("xlsx");
const axios = require("axios");
const sharp = require("sharp");

const app = express();
const PORT = process.env.PORT || 3000;

// IMPORTANT: Use Environment Variables for your database connection string
// In Render.com, you will set this in the "Environment" tab.
// For local development, you can create a .env file (and use npm install dotenv)
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false,
  },
  // Add these connection pool settings
  max: 20, // Maximum number of clients in the pool
  idleTimeoutMillis: 30000, // Close idle clients after 30 seconds
  connectionTimeoutMillis: 2000, // Return an error after 2 seconds if connection could not be established
  maxUses: 7500, // Close a connection after it has been used 7500 times
  keepAlive: true, // Keep connections alive
  keepAliveInitialDelayMillis: 10000, // Start keep-alive probes after 10 seconds
});

// Add error handler for the pool
pool.on("error", (err, client) => {
  console.error("Unexpected error on idle client", err);
});

// Modify the connection test to be more informative
pool.connect((err, client, release) => {
  if (err) {
    console.error("Error connecting to the database:", err.stack);
    return;
  }
  client.query("SELECT NOW()", (err, result) => {
    release();
    if (err) {
      console.error("Error executing test query:", err.stack);
      return;
    }
    console.log("Successfully connected to database at:", result.rows[0].now);
  });
});

// Set up the view engine and middleware
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(express.urlencoded({ extended: true })); // To parse form data
app.use(express.json()); // To parse JSON for export endpoint

const SQL_TO_HEADER_MAP = {
  item: "# ITEM",
  code_number: "CODE NUMBER",
  company_name: "COMPANY NAME",
  sales_contact: "SALES CONTACT",
  product_description: "PRODUCT DESCRIPTION",
  reference_picture: "REFERENCE PICTURE",
  product_real_description: "PRODUCT REAL DESCRIPTION",
  product_real_pictures: "PRODUCT REAL PICTURES",
  sizes_or_capacity: "SIZES OR CAPACITY",
  other_certificate: "OTHER CERTIFICATE",
  logo_details: "LOGO DETAILS",
  other_logo: "OTHER LOGO",
  set_up_charge: "SET UP CHARGE",
  sample_time: "SAMPLE TIME",
  production_time: "PRODUCTION TIME",
  price_usd: "PRICE USD",
  pcs_per_box: "PCS PER BOX",
  gw_kg: "GW KG",
  producto: "PRODUCTO",
  origen: "ORIGEN",
  cbm_per_box: "CBM PER BOX",
};

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
  const {
    producto1,
    producto2,
    producto3,
    producto4,
    producto5,
    descripcion1,
    descripcion2,
    descripcion3,
    descripcion4,
    descripcion5,
    material1,
    material2,
    material3,
    material4,
    material5,
    searchType,
  } = req.body;

  const productos = [
    producto1,
    producto2,
    producto3,
    producto4,
    producto5,
  ].filter((p) => p && p !== "");
  const descripciones = [
    descripcion1,
    descripcion2,
    descripcion3,
    descripcion4,
    descripcion5,
  ].filter((d) => d && d !== "");
  const materiales = [
    material1,
    material2,
    material3,
    material4,
    material5,
  ].filter((m) => m && m !== "");

  let query = "SELECT * FROM products WHERE ";
  const queryParams = [];
  const conditions = [];
  let paramIndex = 1;

  // Build query for PRODUCTO
  if (productos.length > 0) {
    const productConditions = productos.map((_, index) => {
      return `(
        producto ILIKE $${paramIndex + index} OR 
        SIMILARITY(LOWER(unaccent(producto)), LOWER(unaccent($${
          paramIndex + index
        }))) > 0.3 OR
        LOWER(unaccent(producto)) % LOWER(unaccent($${paramIndex + index}))
      )`;
    });

    conditions.push(`(${productConditions.join(" OR ")})`);
    productos.forEach((p) => queryParams.push(p.replace(/%/g, "")));
    paramIndex += productos.length;
  }

  // Build query for DESCRIPCION fields
  if (descripciones.length > 0) {
    const descripcionConditions = descripciones.map((_, index) => {
      return `(
      product_description ILIKE $${paramIndex + index} OR 
      product_real_description ILIKE $${paramIndex + index} OR
      SIMILARITY(LOWER(unaccent(product_description)), LOWER(unaccent($${
        paramIndex + index
      }))) > 0.3 OR
      SIMILARITY(LOWER(unaccent(product_real_description)), LOWER(unaccent($${
        paramIndex + index
      }))) > 0.3 OR
      LOWER(unaccent(product_description)) % LOWER(unaccent($${
        paramIndex + index
      })) OR
      LOWER(unaccent(product_real_description)) % LOWER(unaccent($${
        paramIndex + index
      }))
    )`;
    });
    conditions.push(`(${descripcionConditions.join(" OR ")})`);
    descripciones.forEach((d) => queryParams.push(`%${d}%`));
    paramIndex += descripciones.length;
  }

  // Build query for MATERIAL fields
  if (materiales.length > 0) {
    const materialConditions = materiales.map((_, index) => {
      return `(
      material ILIKE $${paramIndex + index} OR
      SIMILARITY(LOWER(unaccent(material)), LOWER(unaccent($${
        paramIndex + index
      }))) > 0.3 OR
      LOWER(unaccent(material)) % LOWER(unaccent($${paramIndex + index}))
    )`;
    });
    conditions.push(`(${materialConditions.join(" OR ")})`);
    materiales.forEach((m) => queryParams.push(`%${m}%`));
    paramIndex += materiales.length;
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
    console.log("\n=== Query Details ===");
    console.log("Parameters received:", {
      productos,
      descripciones,
      materiales,
      searchType,
    });
    console.log("Executing query:", query);
    console.log("Query parameters:", queryParams);

    const { rows } = await pool.query(query, queryParams);

    // Create a summary title for the results
    const titleParts = [];
    if (productos.length > 0)
      titleParts.push(`PRODUCTO: ${productos.join(" or ")}`);
    if (descripciones.length > 0)
      titleParts.push(`DESCRIPCION: ${descripciones.join(" or ")}`);
    if (materiales.length > 0)
      titleParts.push(`MATERIAL: ${materiales.join(" or ")}`);
    const title = titleParts.join(` ${searchType} `);

    res.json({
      results: rows,
      title: title,
      noResults: rows.length === 0,
    });
  } catch (err) {
    console.error("Database query error", err.stack);
    res
      .status(500)
      .json({ error: "An error occurred while searching the database." });
  }
});
app.get("/test-query", async (req, res) => {
  try {
    // Simple query that should always work
    const result = await pool.query("SELECT COUNT(*) as count FROM products");
    console.log("Test query result:", result.rows[0]);
    res.json({ success: true, count: result.rows[0].count });
  } catch (err) {
    console.error("Test query failed:", err);
    res.status(500).json({ error: err.message });
  }
});
// Export route to generate an XLSX file
app.post("/export", async (req, res) => {
  const { ids } = req.body;

  if (!ids || ids.length === 0) {
    return res.status(400).send("No records to export.");
  }

  try {
    const query = "SELECT * FROM products WHERE id = ANY($1) ORDER BY id;";
    const { rows } = await pool.query(query, [ids]);

    // Transform the data and handle images
    const transformedRows = [];

    for (const row of rows) {
      const transformedRow = {};

      // Transform column names using the mapping
      for (const [sqlColumn, value] of Object.entries(row)) {
        if (SQL_TO_HEADER_MAP[sqlColumn]) {
          transformedRow[SQL_TO_HEADER_MAP[sqlColumn]] = value;
        } else {
          transformedRow[sqlColumn] = value;
        }
      }

      // Handle images
      try {
        // Try product_real_pictures first, then fallback to reference_picture
        const imageUrl = row.product_real_pictures || row.reference_picture;
        if (imageUrl) {
          const response = await axios.get(imageUrl, {
            responseType: "arraybuffer",
          });

          // Resize image to a reasonable size for Excel
          const resizedImage = await sharp(response.data)
            .resize(200, 200, { fit: "inside" })
            .toBuffer();

          // Convert to base64
          const base64Image = resizedImage.toString("base64");

          // Add image data to the row
          transformedRow["IMAGE"] = {
            v: "", // The cell value will be empty
            l: {
              // This defines the image to be placed in the cell
              Target: `data:image/jpeg;base64,${base64Image}`,
              Rel: { Type: "image" },
            },
          };
        }
      } catch (imageError) {
        console.error(
          `Error processing image for record ${row.id}:`,
          imageError
        );
        transformedRow["IMAGE"] = "Image not available";
      }

      transformedRows.push(transformedRow);
    }

    // Create workbook and worksheet
    const workbook = xlsx.utils.book_new();
    const worksheet = xlsx.utils.json_to_sheet(transformedRows);

    // Set column widths
    const colWidths = [];
    for (const key in SQL_TO_HEADER_MAP) {
      colWidths.push({ wch: 20 }); // Set width to 20 characters
    }
    colWidths.push({ wch: 30 }); // Width for image column
    worksheet["!cols"] = colWidths;

    // Set row heights (to accommodate images)
    const rowHeights = [];
    for (let i = 0; i <= transformedRows.length; i++) {
      rowHeights.push({ hpt: 150 }); // Set height to 150 points
    }
    worksheet["!rows"] = rowHeights;

    xlsx.utils.book_append_sheet(workbook, worksheet, "Products");

    // Send the file
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader("Content-Disposition", "attachment; filename=products.xlsx");

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
