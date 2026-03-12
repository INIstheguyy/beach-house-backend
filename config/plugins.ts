export default () => ({
  upload: {
    config: {
      provider: "@strapi/provider-upload-cloudinary",
      providerOptions: {
        cloud_name: process.env.CLD_CLOUD_NAME,
        api_key: process.env.CLD_API_KEY,
        api_secret: process.env.CLD_API_SECRET,
      },
      actionOptions: {
        upload: {},
        uploadStream: {},
        delete: {},
      },
    },
  },
});
