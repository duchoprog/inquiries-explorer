//
require("dotenv").config();
const express = require("express");
const path = require("path");
const { Pool } = require("pg");
const xlsx = require("xlsx");
const ExcelJS = require("exceljs");
const axios = require("axios");
const sharp = require("sharp");

// Helpers
const sanitizeProyectoId = (value) => {
  const match = (value || "")
    .toUpperCase()
    .match(/[A-Z&]{2,}[0-9]{3,}/);
  return match ? match[0] : "";
};

// pg_trgm: prefer strict word similarity over loose string similarity / `%` (default 0.3).
// 0.5 keeps typo tolerance (sombero≈sombrero) while rejecting near-misses (sombrero≠sombrilla).
const FUZZY_SIMILARITY_THRESHOLD = 0.5;
const PRODUCT_SEARCH_COLUMNS = [
  "id",
  "url",
  "project",
  "company_name",
  "sales_contact",
  "wechat",
  "email",
  "product_description",
  "product_real_description",
  "quantity",
  "price_usd",
  "origen",
  "producto",
  "product_real_pictures",
  "reference_picture",
].join(", ");

const app = express();
const PORT = process.env.PORT || 3000;

const dummy=0
const APP_NAME = "inquiries-explorer";

// IMPORTANT: Use Environment Variables for your database connection string
// In Render.com, you will set this in the "Environment" tab.
// For local development, you can create a .env file (and use npm install dotenv)
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false,
  },
  application_name: APP_NAME,
  // Add these connection pool settings
  max: 10, // Maximum number of clients in the pool
  idleTimeoutMillis: 10000, // Recycle before the Supabase pooler drops idle sockets
  connectionTimeoutMillis: 5000, // Return an error after 5 seconds if a connection could not be established
  query_timeout: 20000, // Fail hung queries instead of spinning the UI forever
  maxUses: 7500, // Close a connection after it has been used 7500 times
  keepAlive: true, // Keep connections alive
  keepAliveInitialDelayMillis: 10000, // Start keep-alive probes after 10 seconds
});

// Add error handler for the pool.
pool.on("error", (err, client) => {
  console.error("Unexpected error on idle client", err);
});

async function terminateIdleAppSessions(client) {
  // Only our DB user, never PostgREST / Supabase internals, never this backend.
  // Tagged leftovers are always eligible. Untagged/Supavisor leftovers must be
  // idle > 2 minutes so a second live copy of the app is not killed mid-request.
  const { rows } = await client.query(
    `
    WITH victims AS (
      SELECT pid, application_name, now() - state_change AS idle_for
      FROM pg_stat_activity
      WHERE datname = current_database()
        AND pid <> pg_backend_pid()
        AND usename = current_user
        AND state IN ('idle', 'idle in transaction')
        AND COALESCE(application_name, '') NOT IN (
          'postgrest',
          'postgres_exporter',
          'pg_cron scheduler',
          'Supavisor (auth_query)'
        )
        AND now() - state_change > interval '10 minutes'
        AND (
          application_name = $1
          OR COALESCE(application_name, '') IN ('', 'Supavisor')
        )
    )
    SELECT pid, application_name, idle_for, pg_terminate_backend(pid) AS killed
    FROM victims
    `,
    [APP_NAME]
  );

  if (rows.length === 0) {
    console.log("No leftover idle app sessions to terminate.");
    return;
  }

  console.log(
    `Terminated ${rows.length} idle session(s):`,
    rows.map((row) => ({
      pid: row.pid,
      app: row.application_name || "(none)",
      idle_for: row.idle_for,
      killed: row.killed,
    }))
  );
}

(async () => {
  let client;
  try {
    client = await pool.connect();
    const { rows } = await client.query("SELECT NOW() AS now");
    console.log("Successfully connected to database at:", rows[0].now);
    await terminateIdleAppSessions(client);
  } catch (err) {
    console.error("Error during database startup:", err.stack || err);
  } finally {
    if (client) client.release();
  }
})();

// Set up the view engine and middleware
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(express.urlencoded({ extended: true })); // To parse form data
app.use(express.json()); // To parse JSON for export endpoint
// Serve static files from the 'public' directory
app.use(express.static('public'));


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

// Keepalive target for the browser: must stay cheap, so no DB and no template.
app.get("/healthz", (req, res) => {
  res.type("text/plain").send("ok");
});

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
  let mainQuery = `SELECT ${PRODUCT_SEARCH_COLUMNS} FROM products2`;
  const mainQueryParams = [];
  const mainConditions = [];
  let paramIndex = 1;

  // Build query for PRODUCTO
  if (productos.length > 0) {
    const productConditions = productos.map((_, index) => {
      return `(
        producto ILIKE $${paramIndex + index} OR 
        STRICT_WORD_SIMILARITY(LOWER(unaccent(producto)), LOWER(unaccent($${
          paramIndex + index
        }))) >= ${FUZZY_SIMILARITY_THRESHOLD}
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
      STRICT_WORD_SIMILARITY(LOWER(unaccent(product_description)), LOWER(unaccent($${
        paramIndex + index
      }))) >= ${FUZZY_SIMILARITY_THRESHOLD} OR
      STRICT_WORD_SIMILARITY(LOWER(unaccent(product_real_description)), LOWER(unaccent($${
        paramIndex + index
      }))) >= ${FUZZY_SIMILARITY_THRESHOLD}
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
      STRICT_WORD_SIMILARITY(LOWER(unaccent(material)), LOWER(unaccent($${
        paramIndex + index
      }))) >= ${FUZZY_SIMILARITY_THRESHOLD}
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
        origen IS NULL OR (
          origen NOT ILIKE $${finalParamIndex} AND
          STRICT_WORD_SIMILARITY(LOWER(unaccent(origen)), LOWER(unaccent($${finalParamIndex}))) < ${FUZZY_SIMILARITY_THRESHOLD}
        )
      )`);
      finalQueryParams.push(`%${origenExclude}%`);
      finalParamIndex++;
    }
    
    // Step 2: Include records where origen matches any of the first four fields
    if (origenes.length > 0) {
      const origenIncludeConditions = origenes.map((_, index) => {
        return `(
          origen ILIKE $${finalParamIndex + index} OR
          STRICT_WORD_SIMILARITY(LOWER(unaccent(origen)), LOWER(unaccent($${
            finalParamIndex + index
          }))) >= ${FUZZY_SIMILARITY_THRESHOLD}
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
    const startedAt = Date.now();
    console.log("Product search started", {
      productos,
      descripciones,
      materiales,
      origenes,
      origenExclude,
      searchType,
    });

    const { rows } = await pool.query(finalQuery, finalQueryParams);
    console.log(
      `Product search DB rows received in ${Date.now() - startedAt}ms, rows=${rows.length}`
    );

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

    const stringifyStartedAt = Date.now();
    const payload = JSON.stringify({
      results: rows,
      title: title,
      noResults: rows.length === 0,
      type: "products",
    });
    console.log(
      `Product search JSON built in ${Date.now() - stringifyStartedAt}ms, bytes=${payload.length}`
    );

    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.send(payload);
    console.log(
      `Product search HTTP response sent in ${Date.now() - startedAt}ms total`
    );
  } catch (err) {
    console.error("Database query error", err.stack);
    res
      .status(500)
      .json({ error: "An error occurred while searching the database." });
  }
});
// Invoice search route
app.post("/search-invoices", async (req, res) => {
  const {
    searchTypeInv,
    // proyecto fields
    proyecto_inv_1,
    proyecto_inv_2,
    proyecto_inv_3,
    proyecto_inv_4,
    proyecto_inv_5,
    // producto fields
    producto_inv_1,
    producto_inv_2,
    producto_inv_3,
    producto_inv_4,
    producto_inv_5,
    // descripcion fields
    descripcion_inv_1,
    descripcion_inv_2,
    descripcion_inv_3,
    descripcion_inv_4,
    descripcion_inv_5,
    // origen (pais) fields
    origen_inv_1,
    origen_inv_2,
    origen_inv_3,
    origen_inv_4,
    origen_inv_5,
  } = req.body;

  const proyectos = [
    proyecto_inv_1,
    proyecto_inv_2,
    proyecto_inv_3,
    proyecto_inv_4,
    proyecto_inv_5,
  ]
    .map((p) => sanitizeProyectoId(p || ""))
    .filter((p) => p && p !== "");

  const productosInv = [
    producto_inv_1,
    producto_inv_2,
    producto_inv_3,
    producto_inv_4,
    producto_inv_5,
  ].filter((p) => p && p !== "");

  const descripcionesInv = [
    descripcion_inv_1,
    descripcion_inv_2,
    descripcion_inv_3,
    descripcion_inv_4,
    descripcion_inv_5,
  ].filter((d) => d && d !== "");

  const paises = [
    origen_inv_1,
    origen_inv_2,
    origen_inv_3,
    origen_inv_4,
  ].filter((o) => o && o !== "");

  const paisExclude = origen_inv_5 && origen_inv_5 !== "" ? origen_inv_5 : null;

  let mainQuery = "SELECT * FROM invoices";
  const proyectoConditions = [];
  const proyectoParams = [];
  const optionalConditions = [];
  const optionalParams = [];
  let paramIndex = 1;

  // PROYECTO (exact match on sanitized id; extract sanitized id from DB values)
  if (proyectos.length > 0) {
    const conditions = proyectos.map((_, idx) => {
      return `upper(COALESCE(substring(unaccent(proyecto) from '([A-Z&]{2,}[0-9]{3,})'), '')) = upper(unaccent($${paramIndex + idx}))`;
    });
    proyectoConditions.push(`(${conditions.join(" OR ")})`);
    proyectos.forEach((p) => proyectoParams.push(p));
    paramIndex += proyectos.length;
  }

  // PRODUCTO (optional, fuzzy)
  if (productosInv.length > 0) {
    const conditions = productosInv.map((_, idx) => {
      return `(
        producto ILIKE $${paramIndex + idx} OR
        STRICT_WORD_SIMILARITY(LOWER(unaccent(producto)), LOWER(unaccent($${paramIndex + idx}))) >= ${FUZZY_SIMILARITY_THRESHOLD}
      )`;
    });
    optionalConditions.push(`(${conditions.join(" OR ")})`);
    productosInv.forEach((p) => optionalParams.push(`%${p}%`));
    paramIndex += productosInv.length;
  }

  // DESCRIPCION (optional, fuzzy)
  if (descripcionesInv.length > 0) {
    const conditions = descripcionesInv.map((_, idx) => {
      return `(
        descripcion ILIKE $${paramIndex + idx} OR
        STRICT_WORD_SIMILARITY(LOWER(unaccent(descripcion)), LOWER(unaccent($${paramIndex + idx}))) >= ${FUZZY_SIMILARITY_THRESHOLD}
      )`;
    });
    optionalConditions.push(`(${conditions.join(" OR ")})`);
    descripcionesInv.forEach((d) => optionalParams.push(`%${d}%`));
    paramIndex += descripcionesInv.length;
  }

  // Build final query and apply ORIGEN (pais) filters
  let finalQuery = mainQuery;
  const finalQueryParams = [];
  if (proyectoConditions.length > 0) {
    finalQueryParams.push(...proyectoParams);
  }
  if (optionalConditions.length > 0) {
    finalQueryParams.push(...optionalParams);
  }
  let finalParamIndex = finalQueryParams.length + 1;

  const searchOperator = searchTypeInv === "AND" ? " AND " : " OR ";

  if (proyectoConditions.length > 0 && optionalConditions.length > 0) {
    finalQuery +=
      " WHERE " +
      proyectoConditions.join(" AND ") +
      " AND (" +
      optionalConditions.join(searchOperator) +
      ")";
  } else if (proyectoConditions.length > 0) {
    finalQuery += " WHERE " + proyectoConditions.join(" AND ");
  } else if (optionalConditions.length > 0) {
    finalQuery += " WHERE " + optionalConditions.join(searchOperator);
  }

  if (paises.length > 0 || paisExclude) {
    const origenConditions = [];

    if (paisExclude) {
      origenConditions.push(`(
        pais IS NULL OR (
          pais NOT ILIKE $${finalParamIndex} AND
          STRICT_WORD_SIMILARITY(LOWER(unaccent(pais)), LOWER(unaccent($${finalParamIndex}))) < ${FUZZY_SIMILARITY_THRESHOLD}
        )
      )`);
      finalQueryParams.push(`%${paisExclude}%`);
      finalParamIndex++;
    }

    if (paises.length > 0) {
      const includeConds = paises.map((_, idx) => {
        return `(
          pais ILIKE $${finalParamIndex + idx} OR
          STRICT_WORD_SIMILARITY(LOWER(unaccent(pais)), LOWER(unaccent($${
            finalParamIndex + idx
          }))) >= ${FUZZY_SIMILARITY_THRESHOLD}
        )`;
      });
      origenConditions.push(`(${includeConds.join(" OR ")})`);
      paises.forEach((p) => finalQueryParams.push(`%${p}%`));
      finalParamIndex += paises.length;
    }

    if (origenConditions.length > 0) {
      const hasWhereClause =
        proyectoConditions.length > 0 || optionalConditions.length > 0;
      const whereClause = hasWhereClause ? " AND " : " WHERE ";
      finalQuery += whereClause + `(${origenConditions.join(" AND ")})`;
    }
  }

  // If no filters provided at all
  const hasAnyFilter =
    proyectoConditions.length > 0 ||
    optionalConditions.length > 0 ||
    paises.length > 0 ||
    !!paisExclude;

  if (!hasAnyFilter) {
    return res.json({
      results: [],
      title: "No search criteria provided.",
      type: "invoices",
    });
  }

  finalQuery += " ORDER BY id;";

  try {
    const startedAt = Date.now();
    console.log("Invoice search started", {
      proyectos,
      productosInv,
      descripcionesInv,
      paises,
      paisExclude,
      searchTypeInv,
    });

    const { rows } = await pool.query(finalQuery, finalQueryParams);
    console.log(
      `Invoice search finished in ${Date.now() - startedAt}ms, rows=${rows.length}`
    );

    const titleParts = [];
    if (proyectos.length > 0)
      titleParts.push(`PROYECTO: ${proyectos.join(" or ")}`);
    if (productosInv.length > 0)
      titleParts.push(`PRODUCTO: ${productosInv.join(" or ")}`);
    if (descripcionesInv.length > 0)
      titleParts.push(`DESCRIPCION: ${descripcionesInv.join(" or ")}`);
    if (paises.length > 0) titleParts.push(`PAIS: ${paises.join(" or ")}`);
    if (paisExclude) titleParts.push(`PAIS NO ES: ${paisExclude}`);
    const title = titleParts.join(` ${searchTypeInv || "OR"} `);

    res.json({
      results: rows,
      title,
      noResults: rows.length === 0,
      type: "invoices",
    });
  } catch (err) {
    console.error("Invoice search error", err.stack);
    res
      .status(500)
      .json({ error: "An error occurred while searching invoices." });
  }
});

// Search inquiries (products) by proyecto - used for linked invoice tabs
app.post("/search-inquiries-by-project", async (req, res) => {
  const proyectoRaw = (req.body && req.body.proyecto) || "";
  const proyecto = sanitizeProyectoId(proyectoRaw);
  console.log("Searching inquiry by project sanitized:", proyecto);

  if (!proyecto || proyecto.trim() === "") {
    return res.json({
      results: [],
      title: "No project provided.",
      type: "products",
    });
  }

  // Note: invoices.proyecto corresponds to products.project
  // Use exact match (case-insensitive) on the sanitized proyecto ID to avoid fuzzy hits.
  const query = `
    SELECT * FROM products2
    WHERE upper(unaccent(project)) = upper(unaccent($1))
    ORDER BY id;
  `;

  try {
    const { rows } = await pool.query(query, [proyecto]);
    const title = `PROYECTO: ${proyecto}`;
    res.json({
      results: rows,
      title,
      noResults: rows.length === 0,
      type: "products",
    });
  } catch (err) {
    console.error("Invoice linked inquiry search error", err.stack);
    res
      .status(500)
      .json({ error: "An error occurred while searching linked inquiries." });
  }
});
app.get("/test-query", async (req, res) => {
  try {
    // Simple query that should always work
    const result = await pool.query("SELECT COUNT(*) as count FROM products2");
    console.log("Test query result:", result.rows[0]);
    res.json({ success: true, count: result.rows[0].count });
  } catch (err) {
    console.error("Test query failed:", err);
    res.status(500).json({ error: err.message });
  }
});
// Export images: the picture columns sometimes hold free text around the URL,
// so pull the first http(s) URL out instead of trusting the whole cell.
const EXPORT_IMAGE_HEIGHT = 100;
const EXPORT_IMAGE_CONCURRENCY = 16;
const EXPORT_IMAGE_TIMEOUT_MS = 10000;
const EXPORT_IMAGE_MAX_BYTES = 15 * 1024 * 1024;
const EXPORT_IMAGE_MAX_ATTEMPTS = 3;
// Resized thumbnails are ~3KB each; a few thousand is ~10MB and makes
// repeat exports of the same products (very common) nearly free.
const EXPORT_THUMB_CACHE_MAX = 4000;
const exportThumbCache = new Map(); // url -> { buffer, width, height }

function firstHttpUrl(value) {
  if (!value) return "";
  const match = String(value).match(/https?:\/\/[^\s"'<>]+/i);
  return match ? match[0] : "";
}

function cacheThumb(url, thumb) {
  if (exportThumbCache.size >= EXPORT_THUMB_CACHE_MAX) {
    exportThumbCache.delete(exportThumbCache.keys().next().value); // oldest
  }
  exportThumbCache.set(url, thumb);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableImageError(err) {
  const status = err.response && err.response.status;
  if (status === 429 || (status >= 500 && status < 600)) return true;
  return !status && (err.code === "ECONNABORTED" || err.code === "ECONNRESET" || err.code === "ETIMEDOUT");
}

async function fetchAndResizeImage(url) {
  let attempt = 0;
  for (;;) {
    attempt++;
    try {
      const response = await axios.get(url, {
        responseType: "arraybuffer",
        timeout: EXPORT_IMAGE_TIMEOUT_MS,
        maxContentLength: EXPORT_IMAGE_MAX_BYTES,
        maxRedirects: 3,
      });
      // One sharp pass: resize by height keeps the aspect ratio and reports
      // the resulting dimensions, so no separate metadata() round-trip.
      const { data, info } = await sharp(response.data)
        .resize({ height: EXPORT_IMAGE_HEIGHT, fit: "inside" })
        .jpeg({ quality: 80 })
        .toBuffer({ resolveWithObject: true });
      return { buffer: data, width: info.width, height: info.height };
    } catch (err) {
      if (attempt >= EXPORT_IMAGE_MAX_ATTEMPTS || !isRetryableImageError(err)) {
        throw err;
      }
      // Supabase Storage answers 429 on cold bursts; honour Retry-After if given.
      const retryAfterSec = Number(err.response && err.response.headers["retry-after"]);
      const backoffMs = retryAfterSec > 0 ? retryAfterSec * 1000 : 500 * 2 ** (attempt - 1);
      await sleep(Math.min(backoffMs, 5000));
    }
  }
}

// Resolves to Map<url, {buffer,width,height} | null>. Never rejects.
async function fetchAndResizeImages(urls) {
  const results = new Map();
  const pending = [];
  for (const url of urls) {
    const cached = exportThumbCache.get(url);
    if (cached) {
      results.set(url, cached);
    } else {
      pending.push(url);
    }
  }

  let cursor = 0;
  const worker = async () => {
    while (cursor < pending.length) {
      const url = pending[cursor++];
      try {
        const thumb = await fetchAndResizeImage(url);
        cacheThumb(url, thumb);
        results.set(url, thumb);
      } catch (err) {
        console.error(`Export: image failed ${url}:`, err.message);
        results.set(url, null);
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(EXPORT_IMAGE_CONCURRENCY, pending.length) }, worker)
  );
  console.log(
    `Export: ${urls.length - pending.length} thumbnails from cache, ${pending.length} fetched`
  );
  return results;
}

// Export route to generate an XLSX file
app.post("/export", async (req, res) => {
  const { ids } = req.body;

  if (!ids || ids.length === 0) {
    return res.status(400).send("No records to export.");
  }

  const exportStartedAt = Date.now();
  try {
    console.log(`Export started for ${ids.length} ids`);
    const query = "SELECT * FROM products2 WHERE id = ANY($1) ORDER BY id;";
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

    // Add all data rows first, collecting image placements to resolve later.
    const imageColumns = ["reference_picture", "product_real_pictures"];
    const imageJobs = []; // { rowIndex, columnIndex, url, recordId }
    const addedRows = [];

    for (let i = 0; i < rows.length; i++) {
      const dbRow = rows[i];
      const addedRow = worksheet.addRow(sqlColumns.map((col) => dbRow[col]));
      addedRow.height = 20;
      addedRows.push(addedRow);

      for (const sqlColumn of imageColumns) {
        const url = firstHttpUrl(dbRow[sqlColumn]);
        const columnIndex = sqlColumnIndexMap[sqlColumn];
        if (url && columnIndex) {
          imageJobs.push({ rowIndex: i, columnIndex, url, recordId: dbRow.id });
        }
      }
    }

    // Download + resize concurrently, once per distinct URL.
    const imagesStartedAt = Date.now();
    const resizedByUrl = await fetchAndResizeImages(
      [...new Set(imageJobs.map((job) => job.url))]
    );
    console.log(
      `Export: ${imageJobs.length} image placements, ${resizedByUrl.size} distinct URLs, ` +
        `${[...resizedByUrl.values()].filter(Boolean).length} resized in ${Date.now() - imagesStartedAt}ms`
    );

    const excelImageIdByUrl = new Map();
    for (const job of imageJobs) {
      const resized = resizedByUrl.get(job.url);
      if (!resized) continue;

      let imageId = excelImageIdByUrl.get(job.url);
      if (imageId === undefined) {
        imageId = workbook.addImage({ buffer: resized.buffer, extension: "jpeg" });
        excelImageIdByUrl.set(job.url, imageId);
      }

      worksheet.addImage(imageId, {
        tl: { col: job.columnIndex - 1, row: job.rowIndex + 1 },
        ext: { width: resized.width, height: resized.height },
      });

      const addedRow = addedRows[job.rowIndex];
      addedRow.getCell(job.columnIndex).value = ""; // Clear the URL
      addedRow.height = 110; // Height for rows with images
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
    console.log(
      `Export finished: ${rows.length} rows, ${buffer.length} bytes in ${Date.now() - exportStartedAt}ms`
    );
  } catch (err) {
    console.error("Export error", err.stack);
    res.status(500).send("Error generating export file.");
  }
});

const server = app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});

const shutdown = async (signal) => {
  console.log(`${signal} received, shutting down...`);

  // Render kills the process after a grace period; don't hang past it.
  const forceExit = setTimeout(() => {
    console.error("Shutdown timed out, forcing exit.");
    process.exit(1);
  }, 10000);
  forceExit.unref();

  try {
    await new Promise((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
    await pool.end();
    console.log("Shutdown complete.");
    process.exit(0);
  } catch (err) {
    console.error("Error during shutdown", err);
    process.exit(1);
  }
};

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
