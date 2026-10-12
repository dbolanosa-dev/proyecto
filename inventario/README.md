# Mi Pulpería

Aplicación privada para registrar lotes, existencias, vencimientos, ofertas, ventas y consumo. En el despliegue de Vercel, la interfaz estática se comunica con la API Flask y guarda el inventario compartido en PostgreSQL.

## Ejecución local

Se necesita Python 3.12. Para entrar y probar la aplicación en modo local no hace falta instalar PostgreSQL: guarda sus datos en un archivo SQLite local. El despliegue de Vercel sí requiere PostgreSQL.

1. Desde la raíz del repositorio, cree un entorno virtual e instale las dependencias:

   ```powershell
   python -m venv .venv
   .\.venv\Scripts\Activate.ps1
   python -m pip install -r requirements.txt
   ```

2. Copie `.env.example` a `.env`. Para el modo local, `PULPERIA_PASSWORD` y `SESSION_SECRET` son suficientes. Si configura `POSTGRES_URL`, la aplicación usa PostgreSQL en vez del archivo SQLite local.
3. Inicie la aplicación desde la raíz del repositorio:

   ```powershell
   python app.py
   ```

4. Abra [http://localhost:8000/login](http://localhost:8000/login). En modo local, la base persistente se crea en `.data/pulperia.sqlite3`. Ese directorio se excluye de Git.

## Publicación en Vercel

1. Cree una base PostgreSQL administrada (por ejemplo, Neon) y obtenga su URL de conexión con SSL.
2. Importe el repositorio en Vercel usando la raíz del proyecto como directorio raíz. Vercel detecta el servidor Flask en `app.py`, publica los recursos estáticos de `public/` y los sirve por su CDN.
3. En **Project Settings → Environment Variables**, defina para cada entorno que vaya a utilizar:
   - `POSTGRES_URL`: URL de PostgreSQL con SSL.
   - `PULPERIA_PASSWORD`: contraseña larga y exclusiva para acceder al inventario.
   - `SESSION_SECRET`: secreto aleatorio largo para firmar las sesiones; se puede generar con `python -c "import secrets; print(secrets.token_urlsafe(48))"`.
4. Despliegue o vuelva a desplegar el proyecto para que las variables queden disponibles.
5. Visite `/login` en el dominio de Vercel. Al abrir el inventario por primera vez, se crea la tabla `pulperia_inventory`.

Las credenciales son variables del servidor; no las agregue al código ni las exponga en el navegador. Para bases que codifican caracteres especiales en la contraseña, use una URL de conexión correctamente codificada. El archivo `.env` local está excluido de Git.

## Acceso y almacenamiento

La contraseña compartida autoriza a las personas que la conocen a consultar y modificar el mismo inventario; la aplicación no administra cuentas ni roles individuales. Las sesiones duran ocho horas y usan cookies `HttpOnly`; en Vercel también usan `Secure`. Utilice una contraseña exclusiva y compártala solo con personas autorizadas. SQLite se ofrece únicamente para desarrollo en esta computadora; Vercel requiere `POSTGRES_URL` con una conexión PostgreSQL que admita SSL.

Los productos y movimientos se guardan en PostgreSQL y se sincronizan entre dispositivos. La preferencia de anticipación de avisos se conserva localmente en cada navegador. Descargue respaldos JSON periódicamente: **Restaurar respaldo** reemplaza el inventario compartido, no solo el del dispositivo actual.

Para trasladar datos guardados por la versión anterior del navegador, descargue allí un respaldo, inicie sesión en el despliegue nuevo y use **Restaurar respaldo**. Los datos antiguos no se migran automáticamente.

## Funcionalidades

- Registre lotes individuales con sus fechas, cantidades, costos, precios y códigos de barras.
- Consulte el catálogo de referencia, las alertas de vencimiento y las existencias bajas.
- Cree ofertas temporales y registre ventas, consumo o merma.
- Busque y filtre el inventario, escanee códigos de barras y restaure respaldos.
