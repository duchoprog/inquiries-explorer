
require("dotenv").config();
const express = require("express");
const path = require("path");
const { Pool } = require("pg");
const xlsx = require("xlsx");
const ExcelJS = require("exceljs");
const axios = require("axios");
const sharp = require("sharp");

const app = express();
const PORT = process.env.PORT || 3000;

const dummy=0

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

// Add error handler for the pool.
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
    origen1,
    origen2,
    origen3,
    origen4,
    origen5,
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
  
  const origenes = [
    origen1,
    origen2,
    origen3,
    origen4,
  ].filter((o) => o && o !== "");
  
  const origenExclude = origen5 && origen5 !== "" ? origen5 : null;

  // Step 1: Build main search query (PRODUCTO, DESCRIPCION, MATERIAL)
  let mainQuery = "SELECT * FROM products";
  const mainQueryParams = [];
  const mainConditions = [];
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

    mainConditions.push(`(${productConditions.join(" OR ")})`);
    productos.forEach((p) => mainQueryParams.push(p.replace(/%/g, "")));
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
    mainConditions.push(`(${descripcionConditions.join(" OR ")})`);
    descripciones.forEach((d) => mainQueryParams.push(`%${d}%`));
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
    mainConditions.push(`(${materialConditions.join(" OR ")})`);
    materiales.forEach((m) => mainQueryParams.push(`%${m}%`));
    paramIndex += materiales.length;
  }

  // Add WHERE clause if there are main conditions
  if (mainConditions.length > 0) {
    const searchOperator = searchType === "AND" ? " AND " : " OR ";
    mainQuery += " WHERE " + mainConditions.join(searchOperator);
  }

  // Step 2: Apply ORIGEN filtering as secondary filter
  let finalQuery = mainQuery;
  const finalQueryParams = [...mainQueryParams];
  let finalParamIndex = mainQueryParams.length + 1;

  if (origenes.length > 0 || origenExclude) {
    const origenConditions = [];
    
    // Step 1: Exclude records where origen matches the 5th field (ORIGEN NO ES)
    if (origenExclude) {
      origenConditions.push(`(
        origen IS NULL OR 
        origen NOT ILIKE $${finalParamIndex} AND
        SIMILARITY(LOWER(unaccent(origen)), LOWER(unaccent($${finalParamIndex}))) <= 0.3 AND
        NOT (LOWER(unaccent(origen)) % LOWER(unaccent($${finalParamIndex})))
      )`);
      finalQueryParams.push(`%${origenExclude}%`);
      finalParamIndex++;
    }
    
    // Step 2: Include records where origen matches any of the first four fields
    if (origenes.length > 0) {
      const origenIncludeConditions = origenes.map((_, index) => {
        return `(
          origen ILIKE $${finalParamIndex + index} OR
          SIMILARITY(LOWER(unaccent(origen)), LOWER(unaccent($${
            finalParamIndex + index
          }))) > 0.3 OR
          LOWER(unaccent(origen)) % LOWER(unaccent($${finalParamIndex + index}))
        )`;
      });
      origenConditions.push(`(${origenIncludeConditions.join(" OR ")})`);
      origenes.forEach((o) => finalQueryParams.push(`%${o}%`));
      finalParamIndex += origenes.length;
    }
    
    // Add ORIGEN conditions to the query
    if (origenConditions.length > 0) {
      const whereClause = mainConditions.length > 0 ? " AND " : " WHERE ";
      finalQuery += whereClause + `(${origenConditions.join(" AND ")})`;
    }
  }

  // If no conditions at all, return nothing
  if (mainConditions.length === 0 && origenes.length === 0 && !origenExclude) {
    return res.json({ results: [], title: "No search criteria provided." });
  }

  finalQuery += " ORDER BY id;";

  try {
    console.log("\n=== Query Details ===");
    console.log("Parameters received:", {
      productos,
      descripciones,
      materiales,
      origenes,
      origenExclude,
      searchType,
    });
    console.log("Executing query:", finalQuery);
    console.log("Query parameters:", finalQueryParams);

    const { rows } = await pool.query(finalQuery, finalQueryParams);

    // Create a summary title for the results
    const titleParts = [];
    if (productos.length > 0)
      titleParts.push(`PRODUCTO: ${productos.join(" or ")}`);
    if (descripciones.length > 0)
      titleParts.push(`DESCRIPCION: ${descripciones.join(" or ")}`);
    if (materiales.length > 0)
      titleParts.push(`MATERIAL: ${materiales.join(" or ")}`);
    if (origenes.length > 0)
      titleParts.push(`ORIGEN: ${origenes.join(" or ")}`);
    if (origenExclude)
      titleParts.push(`ORIGEN NO ES: ${origenExclude}`);
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

    // Create workbook and worksheet using ExcelJS
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("Products");

    // Get header names from the SQL to Header mapping
    const headers = Object.values(SQL_TO_HEADER_MAP);
    const sqlColumns = Object.keys(SQL_TO_HEADER_MAP);

    // Add headers row
    const headerRow = worksheet.addRow(headers);

    // Style the header row - bold, capitalized, and proper height
    headerRow.eachCell((cell) => {
      cell.font = { bold: true, size: 12 };
      cell.alignment = { horizontal: "center", vertical: "middle" };
      // Capitalize the text
      if (cell.value && typeof cell.value === "string") {
        cell.value = cell.value.toUpperCase();
      }
    });
    headerRow.height = 30;

    // Set column widths
    headers.forEach((header, index) => {
      const column = worksheet.getColumn(index + 1);
      if (header === "REFERENCE PICTURE" || header === "PRODUCT REAL PICTURES") {
        column.width = 30; // Wider for images
      } else {
        column.width = 20; // Standard width
      }
    });

    // Create a map of SQL column name to Excel column index (1-based)
    const sqlColumnIndexMap = {};
    sqlColumns.forEach((sqlCol, index) => {
      sqlColumnIndexMap[sqlCol] = index + 1;
    });

    // Process each data row
    for (let i = 0; i < rows.length; i++) {
      const dbRow = rows[i];
      const excelRowData = sqlColumns.map((col) => dbRow[col]);

      const addedRow = worksheet.addRow(excelRowData);
      let rowHasImage = false;

      const imageColumns = ["reference_picture", "product_real_pictures"];
      for (const sqlColumn of imageColumns) {
        const imageUrl = dbRow[sqlColumn];
        const columnIndex = sqlColumnIndexMap[sqlColumn];

        if (imageUrl && columnIndex) {
          try {
            const response = await axios.get(imageUrl, {
              responseType: "arraybuffer",
            });

            const metadata = await sharp(response.data).metadata();
            const targetHeight = 100;
            const proportionalWidth = Math.round(
              (metadata.width * targetHeight) / metadata.height
            );

            const resizedImage = await sharp(response.data)
              .resize(proportionalWidth, targetHeight, { fit: "inside" })
              .jpeg({ quality: 80 })
              .toBuffer();

            const imageId = workbook.addImage({
              buffer: resizedImage,
              extension: "jpeg",
            });

            worksheet.addImage(imageId, {
              tl: { col: columnIndex - 1, row: i + 1 },
              ext: { width: proportionalWidth, height: targetHeight },
            });

            const imageCell = addedRow.getCell(columnIndex);
            imageCell.value = ""; // Clear the URL
            rowHasImage = true;
          } catch (imageError) {
            console.error(
              `Error processing image for record ${dbRow.id} (${sqlColumn}):`,
              imageError.message
            );
          }
        }
      }

      if (rowHasImage) {
        addedRow.height = 110; // Height for rows with images
      } else {
        addedRow.height = 20; // Default height
      }
    }

    // Set up response headers
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader("Content-Disposition", "attachment; filename=products.xlsx");

    // Write workbook to buffer and send
    const buffer = await workbook.xlsx.writeBuffer();
    res.send(buffer);
  } catch (err) {
    console.error("Export error", err.stack);
    res.status(500).send("Error generating export file.");
  }
});

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
