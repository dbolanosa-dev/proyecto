# Mi Pulpería

Aplicación web para llevar el inventario de una pulpería: registre lotes con su fecha de ingreso, fecha de vencimiento, cantidad, costo y precio de venta; después anote las ventas o el consumo para actualizar las existencias.

## Cómo abrirla

1. Abra una terminal dentro de esta carpeta.
2. Ejecute `python -m http.server 8000`.
3. Visite [http://localhost:8000](http://localhost:8000) en su navegador.

No requiere instalar paquetes ni tener conexión a internet para funcionar (las fuentes tipográficas externas son opcionales). Se recomienda abrirla siempre desde la misma dirección y el mismo navegador.

## Uso

- **Registrar producto:** cada registro es un lote nuevo. Así puede controlar por separado productos iguales que ingresaron o vencen en fechas distintas.
- **Catálogo de referencia:** al registrar un lote, elija de una lista inicial de más de 200 productos comunes, filtrada por categoría o búsqueda. Seleccionar un artículo completa su nombre y categoría; todavía debe indicar la cantidad y sus precios, y ningún producto se agrega al inventario hasta guardar el lote. También puede escribir productos que no estén en la lista. La lista no asigna códigos de barras ni precios inventados.
- **Productos sin vencimiento:** marque «Este producto no tiene fecha de vencimiento» para artículos como bolsas o artículos de limpieza. Estos no aparecen en las alertas ni reciben descuentos por vencimiento.
- **Descuento automático por vencimiento:** los lotes con existencias reciben 10% de descuento cuando faltan entre 4 y 7 días y 20% cuando faltan 3 días o menos (incluido el día de vencimiento). No se aplica a productos vencidos; el precio vuelve al normal después de la fecha de vencimiento. Si hay otra oferta activa, se sugiere el precio más bajo, sin acumular descuentos.
- **Crear ofertas:** desde el inventario elija «Crear oferta», indique un precio menor al normal y seleccione el día y la hora límite. Las ofertas activas aparecen en el inicio con el descuento y una cuenta regresiva; al llegar la hora dejan de mostrarse y vuelve a usarse el precio normal. Las ventas de un producto en oferta proponen automáticamente el precio especial mientras la promoción siga activa.
- **Registrar salida:** seleccione venta o consumo/merma, indique cantidad, fecha y precio unitario. Las existencias se rebajan y el movimiento queda en el historial.
- **Avisos en el inicio:** vea los lotes que están próximos a vencer y los que tienen tres unidades o menos. Elija avisar con 30, 60, 90 o 120 días de anticipación; la preferencia se guarda en el navegador.
- **Buscar y filtrar:** encuentre productos o revise cuáles están vencidos, dentro del período de aviso configurado o tienen pocas existencias. Desde el inicio puede saltar directamente a esos filtros.
- **Escanear desde el teléfono:** guarde el código de barras al crear un lote y use «Escanear» para buscarlo rápidamente. Si hay existencias, se abre la venta del lote con el vencimiento más próximo; si se agotó, se abre el ingreso de un nuevo lote con los datos del producto. Se puede escribir el código manualmente si el navegador no admite cámara o lectura de códigos.
- **Descargar respaldo:** guarde los productos y movimientos en un archivo JSON. Use «Restaurar respaldo» para cargarlo; importar reemplaza los datos actuales.

## Almacenamiento

La información se guarda en el almacenamiento local del navegador y solo está disponible en ese dispositivo y perfil de navegador. Borrar los datos del navegador puede eliminar el inventario; descargue respaldos con frecuencia. Esta versión no sincroniza información entre dispositivos ni usuarios.

## Abrir en el teléfono

Conecte el teléfono y la computadora a la misma red Wi-Fi, ejecute `python -m http.server 8000 --bind 0.0.0.0` desde esta carpeta y visite `http://DIRECCION-IP-DE-LA-COMPUTADORA:8000` en el teléfono. En Windows, puede consultar la dirección con `ipconfig`. El acceso desde otro dispositivo se sirve por HTTP, por lo que la cámara suele requerir que se publique la app en una dirección segura HTTPS. Mientras tanto, puede buscar productos o escribir el código manualmente. Los datos del teléfono quedan separados de los de la computadora; use los respaldos para trasladarlos.
