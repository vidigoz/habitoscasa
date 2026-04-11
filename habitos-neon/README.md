# MisHábitos ⭐ — Guía de despliegue

## Estructura del proyecto
```
habitos-neon/
├── public/               ← Archivos del sitio web
│   ├── index.html
│   ├── styles.css
│   └── app.js
├── netlify/
│   └── functions/
│       └── api.js        ← Función serverless (conecta a Neon)
├── package.json
├── netlify.toml
└── README.md
```

---

## 🚀 Paso 1 — Subir a Netlify

1. Ve a **[app.netlify.com](https://app.netlify.com)** e inicia sesión
2. Haz clic en **"Add new site" → "Deploy manually"**
3. **Arrastra la carpeta `habitos-neon`** completa al área de drop
4. Netlify desplegará el sitio (sin la BD por ahora, funcionará con datos locales)

---

## 🗄️ Paso 2 — Conectar Neon a Netlify

### Opción A: Desde el dashboard de Netlify (más fácil)
1. En tu sitio de Netlify, ve a **Integrations** → busca **"Neon"**
2. Haz clic en **"Enable"** y sigue los pasos para crear o conectar tu proyecto Neon
3. Netlify añadirá automáticamente la variable `DATABASE_URL` a tu sitio ✅

### Opción B: Manual (si ya tienes Neon)
1. Ve a **[console.neon.tech](https://console.neon.tech)**
2. Abre tu proyecto → **Dashboard** → copia la **Connection string** (empieza con `postgresql://...`)
3. En Netlify, ve a **Site configuration → Environment variables**
4. Añade una variable:
   - **Key:** `DATABASE_URL`
   - **Value:** tu connection string de Neon
5. Haz clic en **"Save"**

---

## 🔄 Paso 3 — Redesplegar

Después de añadir `DATABASE_URL`:
1. En Netlify, ve a **Deploys → Trigger deploy → Deploy site**
2. Espera ~1 minuto
3. Abre tu app — ¡las tablas se crean automáticamente!

---

## ✅ Verificar que funciona

1. Abre tu app en Netlify
2. Ve a **⚙️ Configuración → Base de datos**
3. Debe mostrar **"✅ Conectado a Neon (datos en la nube)"**

Si muestra error, revisa que `DATABASE_URL` esté configurado correctamente.

---

## 📱 Cómo usar la app

### Primer uso
1. Ve a **⚙️ Config** → agrega el nombre de cada hijo
2. Opcional: cambia los nombres de las categorías (Básicos / Extras / Especiales)
3. Selecciona un perfil (botón arriba a la derecha)

### Agregar hábitos
En **🏠 Inicio**, toca una categoría:
- **🔒 Básicos** — Obligatorios. **Deben completarse** para que los puntos de Extras y Especiales sean válidos (sin puntos propios)
- **🔄 Extras** — Hábitos que suman puntos al completarse
- **🏆 Especiales** — Logros con más puntos

### Marcar hábitos
- **Diario** → toca los días de la semana completados (necesita 4+ días para contar como completo)
- **Semanal** → un botón, se marca como hecho o no

### Sistema de puntos
- Los puntos de Extras y Especiales se **bloquean** si los Básicos no están completos
- Los puntos se acumulan en la misma semana

### Nueva semana
Menú lateral → **✨ Nueva semana** → escribe el nombre (ej: "14 al 20 de abril")
- Se guarda el historial automáticamente
- Los hábitos se reinician a 0

### Premios
Ve a **🎁 Premios** → crea premios con su costo en puntos → canjéalos cuando tengas suficientes

---

## 🔧 Notas técnicas

- **Sin BD**: la app usa `localStorage` automáticamente (datos solo en ese dispositivo)
- **Con Neon**: los datos se sincronizan en todos los dispositivos en tiempo real
- Las tablas SQL se crean automáticamente la primera vez que se usa la app
- No necesitas correr ningún script SQL manualmente

---

¡Listo! Tu app de hábitos familiares está en la nube 🚀
