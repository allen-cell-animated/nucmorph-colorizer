import { createRoot } from "react-dom/client";
import React from "react";
import App from "./App";
import "./styles.css";
import { ConfigProvider } from "antd";

// Render React component
const container = document.getElementById("root");
const root = createRoot(container!);
root.render(
  <React.StrictMode>
    <ConfigProvider
      theme={{
        token: {
          colorPrimary: "#8962d3",
          colorLink: "#8962d3",
          colorLinkHover: "#5f369f",
          controlHeight: 24,
          fontFamily: "Lato",
          borderRadiusLG: 4,
        },
      }}
    >
      <App />
    </ConfigProvider>
  </React.StrictMode>
);
