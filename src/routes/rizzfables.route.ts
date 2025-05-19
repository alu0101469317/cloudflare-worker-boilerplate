import { Env } from "../index";
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import * as cheerio from 'cheerio';

/**
 * Scrapes data from RizzFables and upserts into Supabase
 * @param env Environment variables
 * @returns Response with scraping results or error
 */
export async function scrapeRizzFablesScans(env: Env): Promise<Response> {

  // Initialize Supabase client
  const supabaseUrl = env.SUPABASE_URL;
  const supabaseKey = env.SUPABASE_SERVICE_KEY;
  const supabase: SupabaseClient = createClient(supabaseUrl, supabaseKey);

  try {
    // Fetch the HTML page
    const fetchRes = await fetch("https://rizzfables.com/", {
      headers: {
        'Accept': 'text/html,application/xhtml+xml,application/xml',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      }
    });
    
    if (!fetchRes.ok) {
      throw new Error(`Fetch failed: ${fetchRes.status} ${fetchRes.statusText}`);
    }
    
    const html = await fetchRes.text();
    
    const $ = cheerio.load(html);
    const records: Array<{
      title: string;
      chapters: string;
      website_title: string;
      normalizedtitle: string;
      website: string;
      url: string;
    }> = [];
    
    // Each manga is contained in a div with class "utao styletwo"
    $('.utao.styletwo').each((i, element) => {
      const mangaElement = $(element);
      
      // Extract title from the h4 element
      const titleElement = mangaElement.find('h4');
      const title = titleElement.text().trim();
      
      // Extract the first chapter link
      const firstChapterLink = mangaElement.find('.Manhwa li a').first();
      const chapterText = firstChapterLink.text().trim();
      const chapterUrl = firstChapterLink.attr('href');
      
      if (title && chapterText && chapterUrl) {
        // Build full URL (though it's already full) and normalize the title
        const fullUrl = chapterUrl; // It's already a full URL
        const normalizedTitle = title
          .normalize('NFD')
          .replace(/[̀-ͯ]/g, '')
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-+|-+$/g, '');
        
        records.push({
          title: title,
          chapters: chapterText,
          website_title: 'Rizz Fables',
          normalizedtitle: normalizedTitle,
          website: 'https://rizzfables.com',
          url: fullUrl
        });
      }
    });

    // Array para llevar registro de cambios
    const changes = {
      inserted: [] as Array<{title: string, chapter: string}>,
      updated: [] as Array<{title: string, oldChapter: string, newChapter: string}>,
      unchanged: [] as Array<{title: string, chapter: string}>
    };

    // Procesar los registros de manera más eficiente
    if (records.length > 0) {
      // 1. Extraer los normalized titles y websites para buscar todos de una vez
      const normalizedTitles = records.map(record => record.normalizedtitle);
      const websites = [...new Set(records.map(record => record.website))]; // Conjunto único de websites
      
      // 2. Obtener todos los mangas existentes en una sola consulta
      const { data: existingMangas, error: fetchError } = await supabase
        .from('manhwas')
        .select('*')
        .in('normalizedtitle', normalizedTitles)
        .in('website', websites);
        
      if (fetchError) {
        console.error('Error fetching existing manga records:', fetchError.message);
        throw fetchError;
      }
      
      // 3. Crear un mapa para búsqueda rápida por clave compuesta normalizedtitle+website
      const existingMangaMap = new Map();
      if (existingMangas) {
        existingMangas.forEach(manga => {
          // Usar una clave compuesta normalizedtitle_website
          const key = `${manga.normalizedtitle}_${manga.website}`;
          existingMangaMap.set(key, manga);
        });
      }
      
      // 4. Procesar cada registro con el mapa para comparación rápida
      const inserts = [];
      const updates = [];
      
      for (const record of records) {
        const key = `${record.normalizedtitle}_${record.website}`;
        const existingManga = existingMangaMap.get(key);
        
        if (!existingManga) {
          // El manga no existe, lo agregamos a insertar
          inserts.push(record);
          changes.inserted.push({
            title: record.title,
            chapter: record.chapters
          });
          console.log(`Insert RIZZ: ${record.title} with chapter ${record.chapters}`);
        } else {
          // El manga existe, verificamos si necesitamos actualizar el capítulo
          if (existingManga.chapters !== record.chapters) {
            // Extraer números de capítulo para comparación numérica
            const existingChapterNum = extractChapterNumber(existingManga.chapters);
            const newChapterNum = extractChapterNumber(record.chapters);
            
            // Solo actualizamos si el nuevo capítulo es más reciente (número mayor)
            if (newChapterNum > existingChapterNum) {
              updates.push({
                record: record,
                id: existingManga.id, // Guardamos el ID para la actualización
                oldChapter: existingManga.chapters
              });
              changes.updated.push({
                title: record.title,
                oldChapter: existingManga.chapters,
                newChapter: record.chapters
              });
              console.log(`Update RIZZ: ${record.title} from ${existingManga.chapters} to ${record.chapters}`);
            } else {
              changes.unchanged.push({
                title: record.title,
                chapter: existingManga.chapters
              });
            }
          } else {
            changes.unchanged.push({
              title: record.title,
              chapter: existingManga.chapters
            });
          }
        }
      }
      
      // 5. Realizar las operaciones de inserción y actualización en lotes
      if (inserts.length > 0) {
        const { error: insertError } = await supabase
          .from('manhwas')
          .insert(inserts);
          
        if (insertError) {
          console.error(`Error inserting ${inserts.length} mangas:`, insertError.message);
        } else {
          console.log(`Inserted RIZZ ${inserts.length} new mangas`);
        }
      }
      
      // Realizar actualizaciones una por una porque pueden tener diferentes campos para actualizar
      for (const update of updates) {
        const { error: updateError } = await supabase
          .from('manhwas')
          .update({ 
            chapters: update.record.chapters, 
            url: update.record.url 
          })
          .eq('id', update.id);
          
        if (updateError) {
          console.error(`Error updating manga ${update.record.title}:`, updateError.message);
        }
      }
      
    }


    return new Response(JSON.stringify({ 
      success: true, 
      count: records.length,
      changes: {
        inserted: changes.inserted.length,
        updated: changes.updated.length,
        unchanged: changes.unchanged.length
      },
      details: changes
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error: any) {
    console.error("Error in scrapeRizzFablesScans:", error);
    return new Response(JSON.stringify({ success: false, error: error.message || String(error) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

/**
 * Helper function to extract chapter number as a number
 * @param chapterString Chapter string (e.g., "Chapter 123")
 * @returns Extracted chapter number
 */
function extractChapterNumber(chapterString: string): number {
  // Busca patrones como "Chapter 123" o "Ch. 123" y extrae el número
  const match = chapterString.match(/(?:Chapter|Ch\.?)\s*(\d+(?:\.\d+)?)/i);
  if (match && match[1]) {
    return parseFloat(match[1]);
  }
  return 0; // Valor por defecto si no encontramos un número
}
