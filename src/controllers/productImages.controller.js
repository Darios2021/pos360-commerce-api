exports.upload = async (req, res, next) => {
  try {
    const productId = toInt(req.body.productId, 0);
    
    // Usamos req.file (que la ruta ya extrajo de req.files)
    if (!req.file) {
      return res.status(400).json({ ok: false, message: "No se recibió archivo en el campo 'files'" });
    }

    console.log(`[UPLOAD] Procesando archivo: ${req.file.originalname} para producto ${productId}`);

    const bucket = mustEnv("S3_BUCKET");
    const s3 = s3Client();
    
    const ext = path.extname(req.file.originalname).toLowerCase() || ".jpg";
    const key = `products/${productId}/${Date.now()}-${crypto.randomBytes(4).toString("hex")}${ext}`;

    await s3.putObject({
      Bucket: bucket,
      Key: key,
      Body: req.file.buffer,
      ContentType: req.file.mimetype,
      ACL: "public-read" 
    }).promise();

    const img = await ProductImage.create({
      product_id: productId,
      url: publicUrlFor(key),
      sort_order: 0
    });

    res.status(201).json({ ok: true, item: img });

  } catch (e) {
    console.error("[CONTROLLER ERROR]", e);
    next(e);
  }
};