import { Env } from "../index";
import { createClient, SupabaseClient } from '@supabase/supabase-js';

/**
 * Scrapes data from FlameComics API and upserts into Supabase
 * @param env Environment variables
 * @returns Response with scraping results or error
 */
export async function scrapeFlameComics(env: Env): Promise<Response> {

  // Initialize Supabase client
  const supabaseUrl = env.SUPABASE_URL;
  const supabaseKey = env.SUPABASE_SERVICE_KEY;
  const supabase: SupabaseClient = createClient(supabaseUrl, supabaseKey);

  try {
    // Usar la API directamente
    const apiUrl = "https://flamecomics.xyz/api/series";
    
    const fetchRes = await fetch(apiUrl, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
        'Referer': 'https://flamecomics.xyz/',
      }
    });
    
    if (!fetchRes.ok) {
      throw new Error(`API fetch failed: ${fetchRes.status} ${fetchRes.statusText}`);
    }
    
    const apiData = await fetchRes.json();
    
    if (!Array.isArray(apiData)) {
      throw new Error("Unexpected API response format: not an array");
    }
    
    
    // Procesar los datos de la API
    const records: Array<{
      title: string;
      chapters: string;
      website_title: string;
      normalizedtitle: string;
      website: string;
      url: string;
    }> = [];
    
    apiData.forEach(series => {
      try {
        // Verificar que es un manga/manhwa válido con capítulos
        if (!series.label || !series.id || !series.chapter_count) {
          return;
        }
        
        const title = series.label;
        const chapterCount = parseInt(series.chapter_count, 10);
        
        if (isNaN(chapterCount) || chapterCount <= 0) {
          return; // Skip si no tiene capítulos o la cuenta no es válida
        }
        
        const chapterText = `Chapter ${chapterCount}`;
        
        // Construir la URL usando el ID como solicitaste
        const seriesUrl = `https://flamecomics.xyz/series/${series.id}`;
        
        // Normalizar el título para la base de datos
        const normalizedTitle = title
          .normalize('NFD')
          .replace(/[̀-ͯ]/g, '')
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-+|-+$/g, '');
        
        records.push({
          title: title,
          chapters: chapterText,
          website_title: 'Flame Comics',
          normalizedtitle: normalizedTitle,
          website: 'https://flamecomics.xyz',
          url: seriesUrl
        });
        
      } catch (e) {
        console.error(`Error processing API data for: ${series.label || 'unknown manga'}`, e);
      }
    });

    // Si no encontramos ningún manga, informar
    if (records.length === 0) {
      console.warn("WARNING: No manga found in FlameComics API response.");
      return new Response(JSON.stringify({ 
        success: false, 
        count: 0,
        message: "No manga found in FlameComics API response."
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }


    // Array para llevar registro de cambios
    const changes = {
      inserted: [] as Array<{title: string, chapter: string}>,
      updated: [] as Array<{title: string, oldChapter: string, newChapter: string}>,
      unchanged: [] as Array<{title: string, chapter: string}>
    };

    // Procesar los registros
    // 1. Extraer los normalized titles y websites para buscar todos de una vez
    const normalizedTitles = records.map(record => record.normalizedtitle);
    const websites = ['https://flamecomics.xyz'];
    
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
    
    // 3. Crear un mapa para búsqueda rápida
    const existingMangaMap = new Map();
    if (existingMangas) {
      existingMangas.forEach(manga => {
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
        // Manga no existe, insertar
        inserts.push(record);
        changes.inserted.push({
          title: record.title,
          chapter: record.chapters
        });
      } else {
        // Manga existe, verificar si hay que actualizar
        if (existingManga.chapters !== record.chapters) {
          // Extraer números de capítulo para comparación numérica
          const existingChapterNum = extractChapterNumber(existingManga.chapters);
          const newChapterNum = extractChapterNumber(record.chapters);
          
          // Solo actualizar si el nuevo capítulo es más reciente
          if (newChapterNum > existingChapterNum) {
            updates.push({
              record: record,
              id: existingManga.id,
              oldChapter: existingManga.chapters
            });
            changes.updated.push({
              title: record.title,
              oldChapter: existingManga.chapters,
              newChapter: record.chapters
            });
            console.log(`update FLAME: ${record.title} from ${existingManga.chapters} to ${record.chapters}`);
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
    
    // 5. Realizar operaciones de base de datos
    // Insertar nuevos mangas
    if (inserts.length > 0) {
      const { error: insertError } = await supabase
        .from('manhwas')
        .insert(inserts);
        
      if (insertError) {
        console.error(`Error inserting ${inserts.length} mangas:`, insertError.message);
      } else {
        // Mostrar información detallada sobre las inserciones
        inserts.forEach(manga => {
          console.log(`✅ Inserted FLAME: "${manga.title}" with ${manga.chapters}`);
        });
      }
    }
    
    // Actualizar mangas existentes
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
      } else {
        console.log(`✅ Updated FLAME: "${update.record.title}" from ${update.oldChapter} to ${update.record.chapters}`);
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
    console.error("Error in scrapeFlameComics:", error);
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
  // Look for patterns like "Chapter 123" or "Ch. 123" and extract the number
  const match = chapterString.match(/(?:Chapter|Ch\.?)\s*(\d+(?:\.\d+)?)/i);
  if (match && match[1]) {
    return parseFloat(match[1]);
  }
  return 0; // Default value if no number is found
}