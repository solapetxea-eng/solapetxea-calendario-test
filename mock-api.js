// Mock API para modo desarrollo local
// Este archivo intercepta fetch para simular las APIs de Cloudflare Functions

(function initMockAPI() {
  const rollingYears = () => {
    const year = new Date().getFullYear();
    return [year, year + 1];
  };

  // Datos mockeados en memoria
  const mockDB = {
    calendar: null,
    years: rollingYears(),
    offers: []
  };

  // Cargar datos del localStorage
  function loadMockData() {
    const stored = localStorage.getItem('solapetxea_dev_data');
    if (stored) {
      try {
        const data = JSON.parse(stored);
        Object.assign(mockDB, data);
      } catch (e) {
        console.warn('Error loading mock data:', e);
      }
    }
  }

  function saveMockData() {
    localStorage.setItem('solapetxea_dev_data', JSON.stringify(mockDB));
  }

  // Config por defecto
  function getDefaultConfig(years = rollingYears()) {
    const config = {
      version: 1,
      singleOccupancyDiscount: 10,
      units: {
        oketa: { name: 'Oketa', rates: { low: 95, high: 120 } },
        orixol: { name: 'Orixol', rates: { low: 80, high: 90 } }
      },
      seasons: [],
      minimumStays: [],
      manualBlocks: []
    };

    for (const year of years) {
      config.seasons.push(
        { id: `summer-${year}`, name: `Verano ${year}`, type: 'high', start: `${year}-06-15`, end: `${year}-09-15` },
        { id: `october-${year}`, name: `Puente de octubre ${year}`, type: 'high', start: `${year}-10-09`, end: `${year}-10-12` },
        { id: `december-${year}`, name: `Puente de diciembre ${year}`, type: 'high', start: `${year}-12-04`, end: `${year}-12-08` },
        { id: `christmas-${year}`, name: `Navidad ${year}`, type: 'high', start: `${year}-12-24`, end: `${year}-12-31` }
      );
      config.minimumStays.push(
        { id: `oketa-shoulder-${year}`, unit: 'oketa', start: `${year}-05-01`, end: `${year}-09-30`, nights: 2 },
        { id: `oketa-summer-${year}`, unit: 'oketa', start: `${year}-07-01`, end: `${year}-08-31`, nights: 5 },
        { id: `orixol-summer-${year}`, unit: 'orixol', start: `${year}-07-01`, end: `${year}-08-31`, nights: 2 }
      );
    }
    return config;
  }

  // Handlers de API
  const apiHandlers = {
    '/api/calendar': function(req, body) {
      const urlObj = new URL(req.url, window.location.origin);
      const year = Number(urlObj.searchParams.get('year')) || 2026;
      
      const occupancy = { orixol: {}, oketa: {} };
      // Simular algunas fechas ocupadas en julio
      const start = new Date(Date.UTC(year, 6, 15));
      const end = new Date(Date.UTC(year, 6, 20));
      for (let d = new Date(start); d < end; d.setUTCDate(d.getUTCDate() + 1)) {
        const iso = d.toISOString().slice(0, 10);
        occupancy.oketa[iso] = 1;
      }
      
      return {
        ok: true,
        year,
        occupancy,
        offers: mockDB.offers.filter(o => o.enabled),
        updated_at: new Date().toISOString()
      };
    },

    '/api/settings': function(req, body) {
      return {
        ok: true,
        config: mockDB.calendar || getDefaultConfig(mockDB.years)
      };
    },

    '/api/years': function(req, body) {
      return { ok: true, years: rollingYears() };
    },

    '/api/admin/config': function(req, body) {
      if (req.method === 'GET') {
        return {
          ok: true,
          config: mockDB.calendar || getDefaultConfig(mockDB.years)
        };
      }
      if (req.method === 'PUT' && body) {
        mockDB.calendar = body.config;
        saveMockData();
        return {
          ok: true,
          config: body.config,
          saved_at: new Date().toISOString()
        };
      }
    },

    '/api/admin/years': function(req, body) {
      if (req.method === 'GET') {
        return { ok: true, years: rollingYears() };
      }
      if (req.method === 'POST' && body) {
        const year = Number(body.year);
        if (!mockDB.years.includes(year)) {
          mockDB.years.push(year);
          mockDB.years.sort((a, b) => a - b);
          saveMockData();
        }
        return { ok: true, years: mockDB.years };
      }
      if (req.method === 'DELETE' && body) {
        const year = Number(body.year);
        mockDB.years = mockDB.years.filter(y => y !== year);
        saveMockData();
        return { ok: true, years: mockDB.years };
      }
    },

    '/api/admin/offers': function(req, body) {
      if (req.method === 'GET') {
        return { ok: true, offers: mockDB.offers };
      }
      if (req.method === 'POST' && body) {
        if (!body.start_date || !body.end_date || body.start_date >= body.end_date) {
          return { ok: false, error: 'Fechas invalidas.' };
        }
        const id = `offer-${Date.now()}-${Math.random().toString(16).slice(2)}`;
        const offer = { ...body, id, enabled: body.enabled !== false };
        mockDB.offers.push(offer);
        saveMockData();
        return { ok: true, id, offer };
      }
      if (req.method === 'PUT' && body) {
        const idx = mockDB.offers.findIndex(o => o.id === body.id);
        if (idx >= 0) {
          mockDB.offers[idx] = body;
          saveMockData();
        }
        return { ok: true };
      }
      if (req.method === 'DELETE' && body) {
        mockDB.offers = mockDB.offers.filter(o => o.id !== body.id);
        saveMockData();
        return { ok: true };
      }
    }
  };

  // Cargar datos
  loadMockData();

  // Interceptar fetch
  const originalFetch = window.fetch;
  window.fetch = function(resource, init = {}) {
    const url = typeof resource === 'string' ? resource : resource.url;
    const method = (init.method || 'GET').toUpperCase();
    
    // Buscar en handlers
    for (const [route, handler] of Object.entries(apiHandlers)) {
      if (url.includes(route)) {
        try {
          const body = init.body ? JSON.parse(init.body) : null;
          const fakeReq = { url, method };
          const response = handler(fakeReq, body);
          
          return Promise.resolve(new Response(JSON.stringify(response), {
            status: 200,
            headers: { 'content-type': 'application/json; charset=utf-8' }
          }));
        } catch (error) {
          console.error('Mock API error:', error);
          return Promise.reject(error);
        }
      }
    }

    // Para otros recursos, usar fetch original
    return originalFetch.call(this, resource, init);
  };

  console.log('%cMock API initialized', 'color: #25d366; font-weight: bold;');
  console.log('Available endpoints:', Object.keys(apiHandlers));
})();
