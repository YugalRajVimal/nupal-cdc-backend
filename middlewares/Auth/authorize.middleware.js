// middleware/authorize.js
export function authorize(permission) {
    return (req, res, next) => {
      if (!req.user.permissions.includes(permission)) {
        return res.status(403).json({ message: "Forbidden" });
      }
      next();
    };
  }
  