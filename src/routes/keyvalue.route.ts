import { Env } from "..";

export async function updateKeyValue(env: Env) {
  await cron_asura(env);
  return new Response(null, {
    status: 200,
    statusText: "Successfully changed DB Store",
  });
}

const cron_asura = async (c: Env) => {
  try {
    const response = await fetch('https://asuracomic.net/series');
    if (!response.ok) {
      console.error("Failed to fetch AsuraScans");
      return;
    }

    let start_reading = false;
    let read_next = false;
    let read_chapter = false;
    let manhwachapter: string[] = [];
    let manhwaTitle: string[] = [];
    let manhwaData: { title: string; chapter: string }[] = [];

    const rewriter = new HTMLRewriter()
      .on('span', {
        text(text) {
          const trimmedText = text.text.trim();
          
          if (trimmedText) {
            if (trimmedText.toLowerCase().includes('search')) {
              start_reading = true;
            }
            if (start_reading) {
              if (read_next) {
                manhwaTitle.push(trimmedText);
                read_next = false;
              }
              if (read_chapter) {
                manhwachapter.push(trimmedText);
                read_chapter = false;
              }
              if (trimmedText.toLowerCase().includes('manhwa') || trimmedText.toLowerCase().includes('manga') || trimmedText.toLowerCase().includes('manhua')) {
                read_next = true;
              }
              if (trimmedText.toLowerCase().includes('chapter') || trimmedText.toLowerCase().includes('pter')) {
                read_chapter = true;
              }
            }
          }
        },
      });

    await rewriter.transform(response).arrayBuffer();

    if (manhwaTitle.length === 0) {
      console.log("No data found.");
      return;
    }

    // **1. Obtener todos los registros existentes en una sola consulta**
    const placeholders = manhwaTitle.map(() => '?').join(', ');
    const existingRecords = await c.DB.prepare(`
      SELECT id, website_title, chapters FROM manhwas 
      WHERE website_title IN (${placeholders}) AND website = 'https://asuracomic.net'
    `).bind(...manhwaTitle).all<{ id: number; website_title: string; chapters: string }>();

    // **2. Crear un Map para búsqueda rápida**
    const existingMap = new Map(existingRecords.results.map(record => [record.website_title, { id: record.id, chapters: record.chapters }]));

    // **3. Preparar datos para actualización e inserción**
    const updateQueries = [];
    const insertQueries = [];

    for (let i = 0; i < manhwaTitle.length; i++) {
      const title = manhwaTitle[i];
      const chapter = manhwachapter[i] ?? "";

      if (existingMap.has(title)) {
        const existingRecord = existingMap.get(title);
        if (existingRecord && existingRecord.chapters !== chapter) {
          // **Actualizar solo si el capítulo ha cambiado**
          updateQueries.push(c.DB.prepare(`
            UPDATE manhwas SET chapters = ? WHERE id = ?
          `).bind(chapter, existingRecord.id));
        }
      } else {
        // **Insertar nuevo manhwa**
        insertQueries.push(c.DB.prepare(`
          INSERT INTO manhwas (title, website_title, website, alt_title, type, volumes, chapters, status, 
            published_start, published_end, genres, themes, serialization, authors, members, favorites, 
            synopsis, background) 
          VALUES ('', ?, 'https://asuracomic.net', '', '', 0, ?, '', '', '', '', '', '', 0, 0, '', '', '')
        `).bind(title, chapter));
      }
      
      manhwaData.push({ title, chapter });
    }

    // **4. Ejecutar actualizaciones e inserciones en lotes**
    if (updateQueries.length > 0) {
      await Promise.all(updateQueries.map(query => query.run()));
    }
    if (insertQueries.length > 0) {
      await Promise.all(insertQueries.map(query => query.run()));
    }

    console.log("Scraping completed");
    console.log(manhwaData);
    return;
  } catch (error) {
    console.error("Scraping error:", error);
    return;
  }
};
